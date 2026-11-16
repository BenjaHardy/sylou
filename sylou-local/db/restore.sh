#!/usr/bin/env bash
# A backup, back into an install.
#
# It runs in the database's own image as a one-shot on the inside network,
# with the backup folder mounted at /backup. The install must already be
# migrated - `sylou restore` starts a fresh one and migrates it first - and
# the dump is applied as `postgres`, the role allowed to switch the tables'
# own triggers off while it loads.
#
# A0's drill, onto an install whose nine secrets were all new: no error,
# identical row counts in all 58 tables, the files byte-identical, passwords
# still working, and the old install's tokens and keys refused.
set -euo pipefail

export PGHOST=db PGPORT=5432 PGUSER=postgres PGDATABASE=postgres
PGPASSWORD="$(cat /run/secrets/pg_postgres_password)"
export PGPASSWORD

started=$(date +%s)

if [ ! -f /backup/data.sql ]; then
  echo "restore: /backup/data.sql is not there. Give the folder a backup was made into." >&2
  exit 1
fi

# The checksums in the manifest are what the folder promised; if the files
# changed since, stop rather than load half of something.
if [ -f /backup/manifest.txt ]; then
  for name in data.sql files.tar; do
    promised=$(sed -n "s/^$name sha256: //p" /backup/manifest.txt)
    [ -n "$promised" ] || continue
    [ -f "/backup/$name" ] || continue
    found=$(sha256sum "/backup/$name" | cut -d' ' -f1)
    if [ "$promised" != "$found" ]; then
      echo "restore: $name is not the file the manifest describes. Nothing was changed." >&2
      exit 1
    fi
  done
fi

if ! psql -X -q -v ON_ERROR_STOP=1 -f /backup/data.sql >/tmp/restore.log 2>&1; then
  echo "restore: FAILED after $(( $(date +%s) - started )) s; nothing of the dump was kept" >&2
  grep -m 3 -i "error" /tmp/restore.log >&2 || true
  exit 1
fi

if [ -s /backup/files.tar ] && [ -d /storage ]; then
  tar -C /storage -xf /backup/files.tar
fi

psql -X -tA -c "notify pgrst, 'reload schema'" >/dev/null

echo "restore: done in $(( $(date +%s) - started )) s. Everyone signs in again: the sessions are not in a backup."
