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
    key                  = "prod.tfstate"
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
variable "super_admin_username" {
  type    = string
  default = ""
}

module "crm" {
  source               = "../../modules/crm"
  env                  = "prod"
  location             = "centralindia"
  acr_name             = var.acr_name
  super_admin_username = var.super_admin_username
  alert_email          = var.alert_email
  postgres_sku         = "GP_Standard_D4ds_v5"
  postgres_ha          = true
  redis_sku            = "Premium"
  api_min_replicas     = 2
  web_min_replicas     = 2
}

output "front_door_host" { value = module.crm.front_door_host }
output "resource_group" { value = module.crm.resource_group }
