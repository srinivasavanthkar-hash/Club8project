# One-time bootstrap (local state): the Terraform remote-state storage account and the GitHub OIDC
# identity used by CI/CD. Run by a subscription owner:  terraform init && terraform apply
terraform {
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 4.10" }
    azuread = { source = "hashicorp/azuread", version = "~> 3.0" }
  }
}

provider "azurerm" {
  features {}
}

variable "github_repo" {
  description = "owner/repo allowed to deploy"
  type        = string
}

data "azurerm_subscription" "current" {}

resource "azurerm_resource_group" "tf" {
  name     = "rg-club8crm-tfstate"
  location = "centralindia"
}

resource "azurerm_storage_account" "tf" {
  name                            = "stclub8crmtfstate"
  resource_group_name             = azurerm_resource_group.tf.name
  location                        = azurerm_resource_group.tf.location
  account_tier                    = "Standard"
  account_replication_type        = "GRS"
  min_tls_version                 = "TLS1_2"
  shared_access_key_enabled       = false
  allow_nested_items_to_be_public = false
  blob_properties {
    versioning_enabled = true
    delete_retention_policy { days = 30 }
  }
}

resource "azurerm_storage_container" "tf" {
  name                  = "tfstate"
  storage_account_id    = azurerm_storage_account.tf.id
  container_access_type = "private"
}

# GitHub Actions -> Azure via OIDC federated credentials (no client secrets stored anywhere)
resource "azuread_application" "gh" {
  display_name = "club8-crm-github-deploy"
}

resource "azuread_service_principal" "gh" {
  client_id = azuread_application.gh.client_id
}

resource "azuread_application_federated_identity_credential" "env" {
  for_each       = toset(["dev", "staging", "prod"])
  application_id = azuread_application.gh.id
  display_name   = "github-${each.key}"
  audiences      = ["api://AzureADTokenExchange"]
  issuer         = "https://token.actions.githubusercontent.com"
  subject        = "repo:${var.github_repo}:environment:${each.key}"
}

resource "azurerm_role_assignment" "gh_contrib" {
  scope                = data.azurerm_subscription.current.id
  role_definition_name = "Contributor"
  principal_id         = azuread_service_principal.gh.object_id
}

resource "azurerm_role_assignment" "gh_state" {
  scope                = azurerm_storage_account.tf.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azuread_service_principal.gh.object_id
}

output "github_client_id" { value = azuread_application.gh.client_id }
