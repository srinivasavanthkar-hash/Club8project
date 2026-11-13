variable "env" {
  description = "dev | staging | prod"
  type        = string
}

variable "location" {
  description = "Primary region (data residency: Central India)"
  type        = string
  default     = "centralindia"
}

variable "name_prefix" {
  type    = string
  default = "club8crm"
}

variable "image_tag" {
  description = "Initial image tag; CI/CD updates images afterwards"
  type        = string
  default     = "bootstrap"
}

variable "acr_name" {
  description = "Globally unique ACR name (alphanumeric)"
  type        = string
}

variable "postgres_sku" {
  type    = string
  default = "GP_Standard_D2ds_v5"
}

variable "postgres_storage_mb" {
  type    = number
  default = 131072
}

variable "postgres_ha" {
  description = "Zone-redundant HA (prod)"
  type        = bool
  default     = false
}

variable "redis_sku" {
  type    = string
  default = "Standard"
}

variable "api_min_replicas" {
  type    = number
  default = 1
}

variable "web_min_replicas" {
  type    = number
  default = 1
}

variable "alert_email" {
  description = "Operations mailbox for alerts"
  type        = string
}

variable "custom_domain" {
  description = "Optional custom hostname on Front Door (e.g. crm.club8holidays.example)"
  type        = string
  default     = null
}

variable "email_domain" {
  description = "Custom sending domain for system emails (e.g. mail.club8holidays.example). null = Azure-managed domain (dev). DNS records: output email_domain_dns_records; see email.tf. OPEN_QUESTIONS 29."
  type        = string
  default     = null
}

variable "super_admin_username" {
  description = "Designated super-admin who may reset another ADMIN's password when no second admin can approve (docs/DECISIONS.md D-PW-3). Configuration only, never editable in the app. Empty = no fallback."
  type        = string
  default     = ""
}

variable "tags" {
  type    = map(string)
  default = {}
}
