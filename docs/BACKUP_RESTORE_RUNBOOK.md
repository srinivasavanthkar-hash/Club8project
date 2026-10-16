# Backup and restore runbook

## What is backed up
| Data | Mechanism | Retention | Where |
|---|---|---|---|
| PostgreSQL (all CRM data, incl. the audit log) | Flexible Server automated backups + WAL, **point-in-time restore** | 35 days (maximum) | Zone-redundant storage in Central India, **geo-redundant copy in South India** |
| PostgreSQL logical export | `crm-weekly-dump` Container Apps Job (`pg_dump -Fc`, Sunday 02:00 IST) | 7 years (immutability policy, locked in prod) | Blob container `db-backups` |
| Documents (uploads, receipts, notices, vouchers) | Blob **versioning**, **soft delete** (blobs and containers, 30 days), point-in-time restore of block blobs (29 days) | see left | Storage account, GRS (prod: RA-GZRS) |
| Secrets and keys | Key Vault soft delete (90 days) + purge protection | 90 days | Key Vault |
| Infrastructure | Terraform state (versioned blob) + code in Git | — | `stclub8crmtfstate` |

Monitoring: alert rules on API 5xx, PostgreSQL CPU and availability tests. Check the backup-job execution
history weekly (Container Apps → Jobs → `crm-weekly-dump` → Execution history).

## RPO / RTO targets
* RPO ≤ 5 minutes (continuous WAL archiving). RTO ≤ 4 hours for a full regional restore, ≤ 1 hour for an in-region PITR.

## Procedures

### A. Restore the database to a point in time (operator error, bad data fix)
1. Freeze writes: scale `crm-api`, `crm-worker` and `crm-scheduler` to 0 replicas
   (`az containerapp update -g <rg> -n crm-api --min-replicas 0 --max-replicas 0`, and the same for worker and scheduler).
2. Choose the timestamp (UTC) just before the incident. The activity log (`/activity-log`, export to Excel) shows who did what and when.
3. Restore to a **new** server:
   ```bash
   az postgres flexible-server restore -g <rg> -n psql-club8crm-prod-restore \
     --source-server psql-club8crm-prod --restore-time "2026-10-15T05:30:00Z"
   ```
4. Verify on the restored server: row counts of key tables, the latest `activity_log.seq`, and
   `POST /api/v1/activity-log/verify` from a temporary API revision pointed at it.
5. Either repoint `database-url` / `migration-db-url` in Key Vault to the restored server and restart the apps,
   or copy only the affected rows back (preferred for a small fix; record the reason as a correction).
6. Scale the apps back up. Record the incident and the restore in the activity log (the restore operator signs in and
   adds a note) and in the incident ticket.

### B. Regional disaster (Central India unavailable)
1. Geo-restore the database into South India:
   ```bash
   az postgres flexible-server geo-restore -g <dr-rg> -n psql-club8crm-prod-dr \
     --source-server /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.DBforPostgreSQL/flexibleServers/psql-club8crm-prod \
     --location southindia
   ```
2. Storage: initiate account failover (GRS → secondary becomes primary): `az storage account failover -n <account>`.
3. Apply Terraform with `location = "southindia"` into a DR resource group (same modules), point Key Vault secrets
   at the restored server, and deploy the last good image tag with `deploy-env.yml`.
4. Repoint the Front Door origin to the DR web app. Smoke test with the demo script against a test member (no real data changes).

### C. Restore a deleted or overwritten document
* Soft-deleted in the CRM: the blob is still there. A support engineer clears `documents.deleted_at` with a
  documented reason (an admin-only SQL change, recorded in `record_versions`).
* Blob deleted or overwritten in storage: `az storage blob undelete` or promote a previous version
  (`az storage blob copy start --source-blob <name> --source-version-id <id>`).

### D. Restore from a weekly logical dump (older than 35 days)
```bash
az storage blob download --auth-mode login --account-name <acct> -c db-backups -n crm-2026XXXXTXXXXXXZ.dump -f crm.dump
createdb -h <scratch-server> -U crm_owner crm_restore
pg_restore -h <scratch-server> -U crm_owner -d crm_restore --no-owner crm.dump
```
Use the scratch database for investigation only. Production is restored from PITR (procedure A).

### E. Quarterly restore drill (required)
Run procedure A against staging each quarter, then run `POST /activity-log/verify` and the Section 14 demo
scenario (`python -m app.demo_cli`) against the restored copy. Record the duration (RTO evidence).
