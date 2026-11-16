-- One password per database role, read from the secret files.
--
-- This replaces Supabase's own roles.sql, which gives five service roles the
-- same password and takes it from an environment variable. Here each role has
-- its own random password, and none of them is ever an environment variable:
-- psql reads each from the file Docker mounted for this container.
--
-- It runs after the image's own start-up scripts (99- prefix), which create
-- the roles; this only sets what they may sign in with.

\set pg_postgres `cat /run/secrets/pg_postgres_password`
\set pg_authenticator `cat /run/secrets/pg_authenticator_password`
\set pg_auth_admin `cat /run/secrets/pg_auth_admin_password`
\set pg_storage_admin `cat /run/secrets/pg_storage_admin_password`

ALTER USER postgres WITH PASSWORD :'pg_postgres';
ALTER USER authenticator WITH PASSWORD :'pg_authenticator';
ALTER USER supabase_auth_admin WITH PASSWORD :'pg_auth_admin';
ALTER USER supabase_storage_admin WITH PASSWORD :'pg_storage_admin';
