# ------------------------------------------------------------------ Email (Azure Communication Services)
# Password-reset links and security notices (docs/PASSWORD_PROMPT.md Section 7). The API authenticates with its
# managed identity; only the endpoint is configured (Key Vault secret "acs-endpoint"), never a connection string.
#
# Domain: without var.email_domain an Azure-managed domain (*.azurecomm.net) is used, fine for dev. With a custom
# domain (OPEN_QUESTIONS 29) Azure needs DNS records: add the TXT/SPF/DKIM/DKIM2 records from the
# `email_domain_dns_records` output to the domain's DNS, verify the domain in the portal, and add a DMARC record
# (e.g. "_dmarc TXT v=DMARC1; p=quarantine; rua=mailto:<postmaster>"), which Azure does not create.

resource "azurerm_email_communication_service" "email" {
  name                = "ecs-${local.n}"
  resource_group_name = azurerm_resource_group.rg.name
  data_location       = "India"
  tags                = local.tags
}

resource "azurerm_email_communication_service_domain" "domain" {
  name              = var.email_domain == null ? "AzureManagedDomain" : var.email_domain
  email_service_id  = azurerm_email_communication_service.email.id
  domain_management = var.email_domain == null ? "AzureManaged" : "CustomerManaged"
  tags              = local.tags
}

resource "azurerm_communication_service" "acs" {
  name                = "acs-${local.n}"
  resource_group_name = azurerm_resource_group.rg.name
  data_location       = "India"
  tags                = local.tags
}

resource "azurerm_communication_service_email_domain_association" "acs_domain" {
  communication_service_id = azurerm_communication_service.acs.id
  email_service_domain_id  = azurerm_email_communication_service_domain.domain.id
}

# The API sends as its managed identity (no keys). Scoped to this Communication Services resource only.
resource "azurerm_role_assignment" "acs_sender" {
  scope                = azurerm_communication_service.acs.id
  role_definition_name = "Contributor"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

locals {
  email_from   = "Club8 CRM <DoNotReply@${azurerm_email_communication_service_domain.domain.mail_from_sender_domain}>"
  app_base_url = var.custom_domain == null ? "https://${azurerm_cdn_frontdoor_endpoint.ep.host_name}" : "https://${var.custom_domain}"
}
