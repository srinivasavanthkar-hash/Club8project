terraform {
  required_version = ">= 1.6"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 4.10" }
    random  = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

data "azurerm_client_config" "current" {}

locals {
  n    = "${var.name_prefix}-${var.env}"
  prod = var.env == "prod"
  tags = merge({ app = "club8-crm", env = var.env, data_classification = "personal-data" }, var.tags)
}

resource "azurerm_resource_group" "rg" {
  name     = "rg-${local.n}"
  location = var.location
  tags     = local.tags
}

# ------------------------------------------------------------------ networking
resource "azurerm_virtual_network" "vnet" {
  name                = "vnet-${local.n}"
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  address_space       = ["10.40.0.0/16"]
  tags                = local.tags
}

# Egress: the apps subnet has no NSG / UDR / Azure Firewall, so outbound HTTPS is open. The API needs
# api.pwnedpasswords.com:443 (breached-password range API) in addition to the Azure services it reaches over private
# endpoints. If egress is ever locked down, allow that FQDN in Azure Firewall (application rule, HTTPS); an NSG
# cannot filter by FQDN. The app keeps working without it (offline list fallback). See docs/DECISIONS.md D-PW-6.
resource "azurerm_subnet" "apps" {
  name                 = "snet-apps"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.vnet.name
  address_prefixes     = ["10.40.0.0/23"]
  delegation {
    name = "aca"
    service_delegation { name = "Microsoft.App/environments" }
  }
}

resource "azurerm_subnet" "postgres" {
  name                 = "snet-postgres"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.vnet.name
  address_prefixes     = ["10.40.4.0/24"]
  service_endpoints    = ["Microsoft.Storage"]
  delegation {
    name = "pg"
    service_delegation { name = "Microsoft.DBforPostgreSQL/flexibleServers" }
  }
}

resource "azurerm_subnet" "endpoints" {
  name                 = "snet-private-endpoints"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.vnet.name
  address_prefixes     = ["10.40.5.0/24"]
}

resource "azurerm_private_dns_zone" "zones" {
  for_each = {
    postgres = "privatelink.postgres.database.azure.com"
    blob     = "privatelink.blob.core.windows.net"
    vault    = "privatelink.vaultcore.azure.net"
    redis    = "privatelink.redis.cache.windows.net"
    acr      = "privatelink.azurecr.io"
  }
  name                = each.value
  resource_group_name = azurerm_resource_group.rg.name
  tags                = local.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "links" {
  for_each              = azurerm_private_dns_zone.zones
  name                  = "link-${each.key}"
  resource_group_name   = azurerm_resource_group.rg.name
  private_dns_zone_name = each.value.name
  virtual_network_id    = azurerm_virtual_network.vnet.id
}

# ------------------------------------------------------------------ monitoring
resource "azurerm_log_analytics_workspace" "law" {
  name                = "log-${local.n}"
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  sku                 = "PerGB2018"
  retention_in_days   = local.prod ? 365 : 30
  tags                = local.tags
}

resource "azurerm_application_insights" "ai" {
  name                = "appi-${local.n}"
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  workspace_id        = azurerm_log_analytics_workspace.law.id
  application_type    = "web"
  tags                = local.tags
}

# ------------------------------------------------------------------ identity + key vault
resource "azurerm_user_assigned_identity" "app" {
  name                = "id-${local.n}-app"
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  tags                = local.tags
}

resource "azurerm_key_vault" "kv" {
  name                          = substr(replace("kv-${local.n}", "_", "-"), 0, 24)
  location                      = var.location
  resource_group_name           = azurerm_resource_group.rg.name
  tenant_id                     = data.azurerm_client_config.current.tenant_id
  sku_name                      = "premium" # HSM-backed keys for the KYC key-encryption key
  rbac_authorization_enabled    = true
  purge_protection_enabled      = true
  soft_delete_retention_days    = 90
  public_network_access_enabled = false
  tags                          = local.tags
}

resource "azurerm_role_assignment" "kv_deployer" {
  scope                = azurerm_key_vault.kv.id
  role_definition_name = "Key Vault Administrator"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_role_assignment" "kv_app_secrets" {
  scope                = azurerm_key_vault.kv.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

resource "azurerm_role_assignment" "kv_app_crypto" {
  scope                = azurerm_key_vault.kv.id
  role_definition_name = "Key Vault Crypto User" # wrap/unwrap KYC data keys only
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

resource "random_password" "jwt" {
  length  = 64
  special = false
}

resource "random_password" "pg_owner" {
  length  = 40
  special = false
}

resource "random_password" "pg_app" {
  length  = 40
  special = false
}

resource "azurerm_key_vault_secret" "secrets" {
  for_each = {
    "jwt-signing-key"   = random_password.jwt.result
    "database-url"      = "postgresql+asyncpg://crm_app:${random_password.pg_app.result}@${azurerm_postgresql_flexible_server.pg.fqdn}:5432/crm?ssl=require"
    "migration-db-url"  = "postgresql+asyncpg://crm_owner:${random_password.pg_owner.result}@${azurerm_postgresql_flexible_server.pg.fqdn}:5432/crm?ssl=require"
    "redis-url"         = "rediss://:${azurerm_redis_cache.redis.primary_access_key}@${azurerm_redis_cache.redis.hostname}:6380/0"
    "appinsights-conn"  = azurerm_application_insights.ai.connection_string
    "pg-app-password"   = random_password.pg_app.result
    "pg-owner-password" = random_password.pg_owner.result
    "acs-endpoint"      = "https://${azurerm_communication_service.acs.hostname}"
  }
  name         = each.key
  value        = each.value
  key_vault_id = azurerm_key_vault.kv.id
  depends_on   = [azurerm_role_assignment.kv_deployer]
}

# KYC key-encryption key (envelope encryption). Rotated yearly; old versions stay enabled for unwrap.
resource "azurerm_key_vault_key" "kyc" {
  name         = "kyc-kek"
  key_vault_id = azurerm_key_vault.kv.id
  key_type     = "RSA-HSM"
  key_size     = 3072
  key_opts     = ["wrapKey", "unwrapKey"]
  rotation_policy {
    automatic {
      time_before_expiry = "P30D"
    }
    expire_after         = "P13M"
    notify_before_expiry = "P30D"
  }
  depends_on = [azurerm_role_assignment.kv_deployer]
}

resource "azurerm_private_endpoint" "kv" {
  name                = "pe-${local.n}-kv"
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  subnet_id           = azurerm_subnet.endpoints.id
  private_service_connection {
    name                           = "kv"
    private_connection_resource_id = azurerm_key_vault.kv.id
    subresource_names              = ["vault"]
    is_manual_connection           = false
  }
  private_dns_zone_group {
    name                 = "kv"
    private_dns_zone_ids = [azurerm_private_dns_zone.zones["vault"].id]
  }
}

# ------------------------------------------------------------------ PostgreSQL 16 Flexible Server
resource "azurerm_postgresql_flexible_server" "pg" {
  name                          = "psql-${local.n}"
  location                      = var.location
  resource_group_name           = azurerm_resource_group.rg.name
  version                       = "16"
  sku_name                      = var.postgres_sku
  storage_mb                    = var.postgres_storage_mb
  auto_grow_enabled             = true
  delegated_subnet_id           = azurerm_subnet.postgres.id
  private_dns_zone_id           = azurerm_private_dns_zone.zones["postgres"].id
  public_network_access_enabled = false
  administrator_login           = "crm_owner"
  administrator_password        = random_password.pg_owner.result
  backup_retention_days         = 35   # maximum point-in-time restore window
  geo_redundant_backup_enabled  = true # paired region (South India)
  zone                          = "1"
  dynamic "high_availability" {
    for_each = var.postgres_ha ? [1] : []
    content {
      mode                      = "ZoneRedundant"
      standby_availability_zone = "2"
    }
  }
  maintenance_window {
    day_of_week  = 0
    start_hour   = 21 # 02:30 IST Monday
    start_minute = 0
  }
  tags       = local.tags
  depends_on = [azurerm_private_dns_zone_virtual_network_link.links]
}

resource "azurerm_postgresql_flexible_server_database" "crm" {
  name      = "crm"
  server_id = azurerm_postgresql_flexible_server.pg.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

resource "azurerm_postgresql_flexible_server_configuration" "extensions" {
  name      = "azure.extensions"
  server_id = azurerm_postgresql_flexible_server.pg.id
  value     = "PG_TRGM,PGCRYPTO"
}

resource "azurerm_postgresql_flexible_server_configuration" "ssl" {
  name      = "require_secure_transport"
  server_id = azurerm_postgresql_flexible_server.pg.id
  value     = "on"
}

# ------------------------------------------------------------------ Storage (documents + backups)
resource "azurerm_storage_account" "st" {
  name                              = substr(replace("st${local.n}", "-", ""), 0, 24)
  location                          = var.location
  resource_group_name               = azurerm_resource_group.rg.name
  account_tier                      = "Standard"
  account_replication_type          = local.prod ? "RAGZRS" : "GRS"
  min_tls_version                   = "TLS1_2"
  allow_nested_items_to_be_public   = false
  shared_access_key_enabled         = false # managed identity + user-delegation SAS only
  public_network_access_enabled     = false
  infrastructure_encryption_enabled = true
  blob_properties {
    versioning_enabled  = true
    change_feed_enabled = true
    delete_retention_policy {
      days = 30
    }
    container_delete_retention_policy {
      days = 30
    }
    restore_policy {
      days = 29
    }
  }
  tags = local.tags
}

resource "azurerm_storage_container" "documents" {
  name                  = "documents"
  storage_account_id    = azurerm_storage_account.st.id
  container_access_type = "private"
}

resource "azurerm_storage_container" "backups" {
  name                  = "db-backups"
  storage_account_id    = azurerm_storage_account.st.id
  container_access_type = "private"
}

resource "azurerm_storage_container_immutability_policy" "backups" {
  storage_container_resource_manager_id = azurerm_storage_container.backups.id
  immutability_period_in_days           = 2555 # 7 years for long-term logical backups
  protected_append_writes_all_enabled   = false
  locked                                = local.prod
}

resource "azurerm_role_assignment" "blob_app" {
  for_each             = toset(["Storage Blob Data Contributor", "Storage Blob Delegator"])
  scope                = azurerm_storage_account.st.id
  role_definition_name = each.value
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

resource "azurerm_private_endpoint" "blob" {
  name                = "pe-${local.n}-blob"
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  subnet_id           = azurerm_subnet.endpoints.id
  private_service_connection {
    name                           = "blob"
    private_connection_resource_id = azurerm_storage_account.st.id
    subresource_names              = ["blob"]
    is_manual_connection           = false
  }
  private_dns_zone_group {
    name                 = "blob"
    private_dns_zone_ids = [azurerm_private_dns_zone.zones["blob"].id]
  }
}

# Microsoft Defender for Storage: malware scanning on upload; result written as blob index tags and
# delivered to the API via Event Grid (documents stay quarantined until CLEAN).
resource "azurerm_security_center_storage_defender" "st" {
  storage_account_id                          = azurerm_storage_account.st.id
  malware_scanning_on_upload_enabled          = true
  malware_scanning_on_upload_cap_gb_per_month = 500
  sensitive_data_discovery_enabled            = true
}

# ------------------------------------------------------------------ Redis
resource "azurerm_redis_cache" "redis" {
  name                          = "redis-${local.n}"
  location                      = var.location
  resource_group_name           = azurerm_resource_group.rg.name
  capacity                      = local.prod ? 1 : 0
  family                        = var.redis_sku == "Premium" ? "P" : "C"
  sku_name                      = var.redis_sku
  minimum_tls_version           = "1.2"
  non_ssl_port_enabled          = false
  public_network_access_enabled = false
  tags                          = local.tags
}

resource "azurerm_private_endpoint" "redis" {
  name                = "pe-${local.n}-redis"
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  subnet_id           = azurerm_subnet.endpoints.id
  private_service_connection {
    name                           = "redis"
    private_connection_resource_id = azurerm_redis_cache.redis.id
    subresource_names              = ["redisCache"]
    is_manual_connection           = false
  }
  private_dns_zone_group {
    name                 = "redis"
    private_dns_zone_ids = [azurerm_private_dns_zone.zones["redis"].id]
  }
}

# ------------------------------------------------------------------ Container registry
resource "azurerm_container_registry" "acr" {
  name                          = var.acr_name
  location                      = var.location
  resource_group_name           = azurerm_resource_group.rg.name
  sku                           = "Premium"
  admin_enabled                 = false
  public_network_access_enabled = true # GitHub-hosted runners push via OIDC identity; pulls go via private endpoint
  tags                          = local.tags
}

resource "azurerm_role_assignment" "acr_pull" {
  scope                = azurerm_container_registry.acr.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

resource "azurerm_private_endpoint" "acr" {
  name                = "pe-${local.n}-acr"
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  subnet_id           = azurerm_subnet.endpoints.id
  private_service_connection {
    name                           = "acr"
    private_connection_resource_id = azurerm_container_registry.acr.id
    subresource_names              = ["registry"]
    is_manual_connection           = false
  }
  private_dns_zone_group {
    name                 = "acr"
    private_dns_zone_ids = [azurerm_private_dns_zone.zones["acr"].id]
  }
}
