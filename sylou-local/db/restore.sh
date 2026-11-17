#!/usr/bin/env bash
# A backup, back into an install that has no accounts yet.
#
# It runs in the database's own image as a one-shot on the inside network,
# with the backup folder mounted at /backup. The install must already be
# migrated - `sylou restore` starts it, and the migrations run on the way up -
# and the dump is applied as `postgres`, the role allowed to switch the
# tables' own triggers off while it loads.
#
# All of it or none of it: the documents' files go back first, then the data
# loads in one transaction. A file that no row names is never shown, and the
# next restore writes it again; a row whose file is missing would be a broken
# document. So wherever this stops, nothing the app shows has changed.
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

# A backup brings its accounts with it. Beside accounts this install already
# has, they would collide on their addresses, or the install would hold both
# sets: so a backup goes only into an install that has none.
accounts=$(psql -X -tA -c "select count(*) from auth.users")
if [ "$accounts" != "0" ]; then
  echo "restore: this install already has accounts ($accounts), and a backup goes back only into one that has none. Nothing was changed." >&2
  echo "restore: to restore here, back up anything this install holds that you want to keep, then run remove, setup without an email, and restore again." >&2
  exit 1
fi

if [ -s /backup/files.tar ] && [ -d /storage ]; then
  if ! tar -C /storage -xf /backup/files.tar; then
    echo "restore: the documents' files could not be put back, so nothing was loaded." >&2
    exit 1
  fi
fi

# The data and the data API's reload in one transaction: a stop anywhere in it
# keeps nothing, and the reload goes out with the data or not at all.
if ! psql -X -q -v ON_ERROR_STOP=1 --single-transaction -f /backup/data.sql \
  -c "notify pgrst, 'reload schema'" >/tmp/restore.log 2>&1; then
  echo "restore: FAILED after $(( $(date +%s) - started )) s; nothing of the dump was kept" >&2
  grep -m 3 -i "error" /tmp/restore.log >&2 || true
  exit 1
fi

echo "restore: done in $(( $(date +%s) - started )) s. Everyone signs in again: the sessions are not in a backup."
