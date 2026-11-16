#!/usr/bin/env bash
# New secrets for an install that already exists.
#
# `sylou rotate` makes a fresh set of secret files beside the old ones and
# then runs this, in the database's own image, on the inside network: the old
# passwords are what it signs in with, the new ones are what it sets. Only
# when this has worked do the new files take the old ones' place.
#
# The writing is untouched. Everyone signs in again, because the signing
# secret is new and every session was signed with the old one.
set -euo pipefail

# As supabase_admin, the role the image makes a superuser: `postgres` is not
# one here, and "supabase_admin is a reserved role, only superusers can
# modify it" is what the database answers when it tries.
export PGHOST=db PGPORT=5432 PGUSER=supabase_admin PGDATABASE=postgres
PGPASSWORD="$(cat /run/secrets/pg_supabase_admin_password)"
export PGPASSWORD

new=/new
for name in pg_supabase_admin_password pg_postgres_password pg_authenticator_password \
            pg_auth_admin_password pg_storage_admin_password; do
  if [ ! -s "$new/$name" ]; then
    echo "rotate: $new/$name is missing or empty; nothing was changed." >&2
    exit 1
  fi
done

# One statement per role, each with the password read from its own file, so
# no password is ever an argument or a line of SQL written down anywhere.
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
\set supabase_admin `cat /new/pg_supabase_admin_password`
\set postgres `cat /new/pg_postgres_password`
\set authenticator `cat /new/pg_authenticator_password`
\set auth_admin `cat /new/pg_auth_admin_password`
\set storage_admin `cat /new/pg_storage_admin_password`

ALTER USER supabase_admin WITH PASSWORD :'supabase_admin';
ALTER USER postgres WITH PASSWORD :'postgres';
ALTER USER authenticator WITH PASSWORD :'authenticator';
ALTER USER supabase_auth_admin WITH PASSWORD :'auth_admin';
ALTER USER supabase_storage_admin WITH PASSWORD :'storage_admin';
SQL

echo "rotate: the database now expects the new passwords"
