-- Local only: the runtime role the API uses. It gets DML grants from the Alembic migration,
-- but only SELECT/INSERT on the append-only audit tables.
CREATE ROLE crm_app LOGIN PASSWORD 'crm_app_dev';
GRANT CONNECT ON DATABASE crm TO crm_app;
