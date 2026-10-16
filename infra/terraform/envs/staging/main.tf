terraform {
  required_version = ">= 1.6"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 4.10" }
    random  = { source = "hashicorp/random", version = "~> 3.6" }
  }
  # Remote state in an Azure Storage account (created once by ../../bootstrap). Auth via OIDC / Azure AD.
  backend "azurerm" {
    resource_group_name  = "rg-club8crm-tfstate"
    storage_account_name = "stclub8crmtfstate"
    container_name       = "tfstate"
    key                  = "staging.tfstate"
    use_azuread_auth     = true
  }
}

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy = false
    }
  }
  storage_use_azuread = true
}

variable "alert_email" { type = string }
variable "acr_name" { type = string }

module "crm" {
  source           = "../../modules/crm"
  env              = "staging"
  location         = "centralindia"
  acr_name         = var.acr_name
  alert_email      = var.alert_email
  postgres_sku     = "GP_Standard_D2ds_v5"
  postgres_ha      = false
  redis_sku        = "Standard"
  api_min_replicas = 1
  web_min_replicas = 1
}

output "front_door_host" { value = module.crm.front_door_host }
output "resource_group" { value = module.crm.resource_group }
