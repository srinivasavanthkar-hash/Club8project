# ------------------------------------------------------------------ Container Apps
resource "azurerm_container_app_environment" "cae" {
  name                           = "cae-${local.n}"
  location                       = var.location
  resource_group_name            = azurerm_resource_group.rg.name
  log_analytics_workspace_id     = azurerm_log_analytics_workspace.law.id
  infrastructure_subnet_id       = azurerm_subnet.apps.id
  internal_load_balancer_enabled = true # nothing is public; Front Door reaches the web app over Private Link
  zone_redundancy_enabled        = local.prod
  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
  }
  tags = local.tags
}

locals {
  image_api = "${azurerm_container_registry.acr.login_server}/crm-api:${var.image_tag}"
  image_web = "${azurerm_container_registry.acr.login_server}/crm-web:${var.image_tag}"
  kv_secrets = {
    "database-url"     = "database-url"
    "migration-db-url" = "migration-db-url"
    "jwt-signing-key"  = "jwt-signing-key"
    "redis-url"        = "redis-url"
    "appinsights-conn" = "appinsights-conn"
  }
  backend_env = {
    CRM_ENV                 = var.env
    CRM_BLOB_PROVIDER       = "azure"
    CRM_BLOB_ACCOUNT_URL    = azurerm_storage_account.st.primary_blob_endpoint
    CRM_VIRUS_SCAN_PROVIDER = "defender"
    CRM_KYC_KEY_PROVIDER    = "keyvault"
    CRM_KEYVAULT_URL        = azurerm_key_vault.kv.vault_uri
    CRM_OTEL_ENABLED        = "true"
    AZURE_CLIENT_ID         = azurerm_user_assigned_identity.app.client_id
  }
  backend_secret_env = {
    CRM_DATABASE_URL                          = "database-url"
    CRM_JWT_SIGNING_KEY                       = "jwt-signing-key"
    CRM_REDIS_URL                             = "redis-url"
    CRM_APPLICATIONINSIGHTS_CONNECTION_STRING = "appinsights-conn"
  }
}

# Shared definition for API / worker / scheduler (same image, different command)
resource "azurerm_container_app" "backend" {
  for_each = {
    "crm-api"       = { cmd = null, min = var.api_min_replicas, max = 10, ingress = true }
    "crm-worker"    = { cmd = ["dramatiq", "app.jobs.tasks", "--processes", "2", "--threads", "4"], min = 1, max = 4, ingress = false }
    "crm-scheduler" = { cmd = ["python", "-m", "app.jobs.scheduler"], min = 1, max = 1, ingress = false }
  }
  name                         = each.key
  container_app_environment_id = azurerm_container_app_environment.cae.id
  resource_group_name          = azurerm_resource_group.rg.name
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"
  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }
  registry {
    server   = azurerm_container_registry.acr.login_server
    identity = azurerm_user_assigned_identity.app.id
  }
  dynamic "secret" {
    for_each = local.kv_secrets
    content {
      name                = secret.key
      key_vault_secret_id = "${azurerm_key_vault.kv.vault_uri}secrets/${secret.value}"
      identity            = azurerm_user_assigned_identity.app.id
    }
  }
  dynamic "ingress" {
    for_each = each.value.ingress ? [1] : []
    content {
      external_enabled = false # reachable only from inside the environment (the web app)
      target_port      = 8000
      transport        = "http"
      traffic_weight {
        latest_revision = true
        percentage      = 100
      }
    }
  }
  template {
    min_replicas = each.value.min
    max_replicas = each.value.max
    container {
      name    = "app"
      image   = local.image_api
      cpu     = 1
      memory  = "2Gi"
      command = each.value.cmd
      dynamic "env" {
        for_each = local.backend_env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = local.backend_secret_env
        content {
          name        = env.key
          secret_name = env.value
        }
      }
      dynamic "liveness_probe" {
        for_each = each.value.ingress ? [1] : []
        content {
          transport = "HTTP"
          port      = 8000
          path      = "/healthz"
        }
      }
      dynamic "readiness_probe" {
        for_each = each.value.ingress ? [1] : []
        content {
          transport = "HTTP"
          port      = 8000
          path      = "/readyz"
        }
      }
    }
    dynamic "http_scale_rule" {
      for_each = each.value.ingress ? [1] : []
      content {
        name                = "http"
        concurrent_requests = "50"
      }
    }
  }
  tags       = local.tags
  depends_on = [azurerm_role_assignment.kv_app_secrets, azurerm_role_assignment.acr_pull]
  lifecycle {
    ignore_changes = [template[0].container[0].image] # CI/CD owns the image tag
  }
}

resource "azurerm_container_app" "web" {
  name                         = "crm-web"
  container_app_environment_id = azurerm_container_app_environment.cae.id
  resource_group_name          = azurerm_resource_group.rg.name
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"
  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }
  registry {
    server   = azurerm_container_registry.acr.login_server
    identity = azurerm_user_assigned_identity.app.id
  }
  ingress {
    external_enabled = true # "external" within the internal environment = reachable by Front Door Private Link
    target_port      = 3000
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }
  template {
    min_replicas = var.web_min_replicas
    max_replicas = 10
    container {
      name   = "web"
      image  = local.image_web
      cpu    = 0.5
      memory = "1Gi"
      env {
        name  = "CRM_ENV" # environment ribbon (DEV / STAGING); nothing is shown in prod
        value = var.env
      }
      liveness_probe {
        transport = "HTTP"
        port      = 3000
        path      = "/login"
      }
    }
    http_scale_rule {
      name                = "http"
      concurrent_requests = "100"
    }
  }
  tags = local.tags
  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }
}

# Pre-deploy migration job (triggered by CI/CD) and weekly logical backup to the immutable container
resource "azurerm_container_app_job" "migrate" {
  name                         = "crm-migrate"
  location                     = var.location
  resource_group_name          = azurerm_resource_group.rg.name
  container_app_environment_id = azurerm_container_app_environment.cae.id
  replica_timeout_in_seconds   = 1800
  manual_trigger_config {
    parallelism              = 1
    replica_completion_count = 1
  }
  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }
  registry {
    server   = azurerm_container_registry.acr.login_server
    identity = azurerm_user_assigned_identity.app.id
  }
  secret {
    name                = "migration-db-url"
    key_vault_secret_id = "${azurerm_key_vault.kv.vault_uri}secrets/migration-db-url"
    identity            = azurerm_user_assigned_identity.app.id
  }
  secret {
    name                = "pg-app-password"
    key_vault_secret_id = "${azurerm_key_vault.kv.vault_uri}secrets/pg-app-password"
    identity            = azurerm_user_assigned_identity.app.id
  }
  template {
    container {
      env {
        name        = "CRM_APP_DB_PASSWORD"
        secret_name = "pg-app-password"
      }
      name    = "migrate"
      image   = local.image_api
      cpu     = 0.5
      memory  = "1Gi"
      command = ["alembic", "upgrade", "head"]
      env {
        name        = "CRM_MIGRATION_DATABASE_URL"
        secret_name = "migration-db-url"
      }
      env {
        name  = "CRM_APP_DB_ROLE"
        value = "crm_app"
      }
    }
  }
  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }
}

resource "azurerm_container_app_job" "pg_dump" {
  name                         = "crm-weekly-dump"
  location                     = var.location
  resource_group_name          = azurerm_resource_group.rg.name
  container_app_environment_id = azurerm_container_app_environment.cae.id
  replica_timeout_in_seconds   = 7200
  schedule_trigger_config {
    cron_expression = "30 20 * * 6" # Sunday 02:00 IST
  }
  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }
  secret {
    name                = "pg-owner-password"
    key_vault_secret_id = "${azurerm_key_vault.kv.vault_uri}secrets/pg-owner-password"
    identity            = azurerm_user_assigned_identity.app.id
  }
  template {
    container {
      name   = "dump"
      image  = "mcr.microsoft.com/azure-cli:2.67.0"
      cpu    = 1
      memory = "2Gi"
      command = ["/bin/sh", "-c", join(" && ", [
        "tdnf install -y postgresql16 >/dev/null",
        "F=crm-$(date -u +%Y%m%dT%H%M%SZ).dump",
        "PGPASSWORD=$PGPASSWORD pg_dump -Fc -h ${azurerm_postgresql_flexible_server.pg.fqdn} -U crm_owner -d crm -f /tmp/$F",
        "az login --identity --username ${azurerm_user_assigned_identity.app.client_id} >/dev/null",
        "az storage blob upload --auth-mode login --account-name ${azurerm_storage_account.st.name} -c db-backups -n $F -f /tmp/$F",
      ])]
      env {
        name        = "PGPASSWORD"
        secret_name = "pg-owner-password"
      }
    }
  }
}

# ------------------------------------------------------------------ Front Door Premium + WAF (only public entry)
resource "azurerm_cdn_frontdoor_profile" "fd" {
  name                = "afd-${local.n}"
  resource_group_name = azurerm_resource_group.rg.name
  sku_name            = "Premium_AzureFrontDoor"
  tags                = local.tags
}

resource "azurerm_cdn_frontdoor_endpoint" "ep" {
  name                     = "ep-${local.n}"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.fd.id
}

resource "azurerm_cdn_frontdoor_origin_group" "web" {
  name                     = "web"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.fd.id
  load_balancing {}
  health_probe {
    path                = "/login"
    protocol            = "Https"
    interval_in_seconds = 60
    request_type        = "GET"
  }
}

resource "azurerm_cdn_frontdoor_origin" "web" {
  name                           = "crm-web"
  cdn_frontdoor_origin_group_id  = azurerm_cdn_frontdoor_origin_group.web.id
  host_name                      = azurerm_container_app.web.ingress[0].fqdn
  origin_host_header             = azurerm_container_app.web.ingress[0].fqdn
  certificate_name_check_enabled = true
  enabled                        = true
  private_link {
    location               = var.location
    private_link_target_id = azurerm_container_app_environment.cae.id
    target_type            = "managedEnvironments"
    request_message        = "Front Door to Club8 CRM"
  }
}

resource "azurerm_cdn_frontdoor_route" "web" {
  name                          = "web"
  cdn_frontdoor_endpoint_id     = azurerm_cdn_frontdoor_endpoint.ep.id
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.web.id
  cdn_frontdoor_origin_ids      = [azurerm_cdn_frontdoor_origin.web.id]
  patterns_to_match             = ["/*"]
  supported_protocols           = ["Http", "Https"]
  https_redirect_enabled        = true
  forwarding_protocol           = "HttpsOnly"
  link_to_default_domain        = true
  # no caching: every page carries personal data
}

resource "azurerm_cdn_frontdoor_firewall_policy" "waf" {
  name                = replace("waf${local.n}", "-", "")
  resource_group_name = azurerm_resource_group.rg.name
  sku_name            = azurerm_cdn_frontdoor_profile.fd.sku_name
  mode                = "Prevention"
  managed_rule {
    type    = "Microsoft_DefaultRuleSet"
    version = "2.1"
    action  = "Block"
  }
  managed_rule {
    type    = "Microsoft_BotManagerRuleSet"
    version = "1.1"
    action  = "Block"
  }
  custom_rule {
    name                           = "LoginRateLimit"
    type                           = "RateLimitRule"
    priority                       = 10
    action                         = "Block"
    rate_limit_duration_in_minutes = 1
    rate_limit_threshold           = 30
    match_condition {
      match_variable = "RequestUri"
      operator       = "Contains"
      match_values   = ["/api/v1/auth/login"]
    }
  }
}

resource "azurerm_cdn_frontdoor_security_policy" "waf" {
  name                     = "waf"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.fd.id
  security_policies {
    firewall {
      cdn_frontdoor_firewall_policy_id = azurerm_cdn_frontdoor_firewall_policy.waf.id
      association {
        patterns_to_match = ["/*"]
        domain {
          cdn_frontdoor_domain_id = azurerm_cdn_frontdoor_endpoint.ep.id
        }
      }
    }
  }
}

# ------------------------------------------------------------------ alerts
resource "azurerm_monitor_action_group" "ops" {
  name                = "ag-${local.n}"
  resource_group_name = azurerm_resource_group.rg.name
  short_name          = "crmops"
  email_receiver {
    name          = "ops"
    email_address = var.alert_email
  }
}

resource "azurerm_monitor_metric_alert" "api_5xx" {
  name                = "api-5xx-${local.n}"
  resource_group_name = azurerm_resource_group.rg.name
  scopes              = [azurerm_application_insights.ai.id]
  severity            = 1
  frequency           = "PT5M"
  window_size         = "PT15M"
  criteria {
    metric_namespace = "microsoft.insights/components"
    metric_name      = "requests/failed"
    aggregation      = "Count"
    operator         = "GreaterThan"
    threshold        = 20
  }
  action {
    action_group_id = azurerm_monitor_action_group.ops.id
  }
}

resource "azurerm_monitor_metric_alert" "pg_cpu" {
  name                = "pg-cpu-${local.n}"
  resource_group_name = azurerm_resource_group.rg.name
  scopes              = [azurerm_postgresql_flexible_server.pg.id]
  severity            = 2
  criteria {
    metric_namespace = "Microsoft.DBforPostgreSQL/flexibleServers"
    metric_name      = "cpu_percent"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 80
  }
  action {
    action_group_id = azurerm_monitor_action_group.ops.id
  }
}

resource "azurerm_application_insights_standard_web_test" "availability" {
  name                    = "avail-${local.n}"
  resource_group_name     = azurerm_resource_group.rg.name
  location                = var.location
  application_insights_id = azurerm_application_insights.ai.id
  geo_locations           = ["apac-sg-sin-azr", "emea-gb-db3-azr", "us-va-ash-azr"]
  frequency               = 300
  request {
    url = "https://${azurerm_cdn_frontdoor_endpoint.ep.host_name}/login"
  }
}
