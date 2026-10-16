output "resource_group" { value = azurerm_resource_group.rg.name }
output "front_door_host" { value = azurerm_cdn_frontdoor_endpoint.ep.host_name }
output "acr_login_server" { value = azurerm_container_registry.acr.login_server }
output "key_vault_uri" { value = azurerm_key_vault.kv.vault_uri }
output "postgres_fqdn" { value = azurerm_postgresql_flexible_server.pg.fqdn }
output "app_identity_client_id" { value = azurerm_user_assigned_identity.app.client_id }
output "storage_account" { value = azurerm_storage_account.st.name }
