#!/usr/bin/env bash
# Everything this install holds, without the rows it can make again.
#
# It runs in the database's own image, because that is where pg_dump lives,
# as a one-shot on the inside network. The folder you chose is mounted at
# /backup; the secrets file is never part of a backup (D9).
#
# What is left out, and why:
#   the services' own migration tables  - the new install makes its own
#   storage.buckets and its neighbours  - storage writes them at start-up,
#                                         and its migrations are one-way
#   the session tables                  - A0 restored a backup and an old
#                                         refresh token still worked, because
#                                         a session is a row here, not a
#                                         signed token. Leaving them out also
#                                         means an old browser session fails
#                                         cleanly instead of showing an empty
#                                         Sylou. Everyone signs in again.
set -euo pipefail

export PGHOST=db PGPORT=5432 PGUSER=postgres PGDATABASE=postgres
PGPASSWORD="$(cat /run/secrets/pg_postgres_password)"
export PGPASSWORD

out=/backup
started=$(date +%s)

{
  # The dump turns the tables' own triggers off while it loads; only a role
  # allowed to do that can apply it, which is why restore runs as postgres.
  echo "SET session_replication_role = replica;"
  pg_dump --data-only --quote-all-identifiers \
    --schema public --schema auth --schema storage \
    --exclude-table 'auth.schema_migrations' \
    --exclude-table 'auth.refresh_tokens' \
    --exclude-table 'auth.sessions' \
    --exclude-table 'auth.mfa_amr_claims' \
    --exclude-table 'auth.flow_state' \
    --exclude-table 'auth.one_time_tokens' \
    --exclude-table 'storage.migrations' \
    --exclude-table 'storage.buckets' \
    --exclude-table 'storage.buckets_analytics' \
    --exclude-table 'storage.buckets_vectors' \
    --exclude-table 'storage.vector_indexes'
  echo "RESET ALL;"
} > "$out/data.sql"

# The documents people imported: the storage volume, as it stands.
if [ -d /storage ]; then
  tar -C /storage -cf "$out/files.tar" .
else
  : > "$out/files.tar"
fi

schema=$(psql -X -tA -c "select coalesce(max(version), '') from sylou_local.migrations")
rows=$(psql -X -tA -c "select coalesce(string_agg(format('%s.%s=%s', schemaname, relname, n_live_tup), ' ' order by schemaname, relname), '') from pg_stat_user_tables where schemaname in ('public','auth','storage') and n_live_tup > 0")

cat > "$out/manifest.txt" <<EOF
made: $(date -u +%Y-%m-%dT%H:%M:%SZ)
release: ${SYLOU_VERSION:-dev}
schema_version: $schema
data.sql sha256: $(sha256sum "$out/data.sql" | cut -d' ' -f1)
data.sql bytes: $(stat -c %s "$out/data.sql")
files.tar sha256: $(sha256sum "$out/files.tar" | cut -d' ' -f1)
files.tar bytes: $(stat -c %s "$out/files.tar")
rows (estimate): $rows
EOF

echo "backup: $(stat -c %s "$out/data.sql") bytes of data and $(stat -c %s "$out/files.tar") bytes of files in $(( $(date +%s) - started )) s; schema $schema"
echo "backup: the secrets are NOT in here. Keep them, or this backup opens nothing."
