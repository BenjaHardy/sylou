#!/bin/sh
# Writes /sylou-runtime.js, the file this install's pages load before the app
# starts (src/lib/runtime-config.ts): the publishable key the browser signs in
# and reads data with, and the password floor the sign-in service enforces.
#
# The key arrives as a file — never as a build argument, never baked into the
# image, never in the environment of a published image — and is checked here,
# at every start, so an install restored from a backup or copied by hand is
# checked too. The file is written under the tmpfs at /tmp, because the root
# filesystem is read-only. A missing or malformed key stops the container
# (nginx's entrypoint runs with set -e) rather than serving an app that would
# fail at sign-in with nothing to explain it.
set -eu

KEY_FILE="${SYLOU_PUBLISHABLE_KEY_FILE:-/run/secrets/publishable_key}"
MIN_PASSWORD_LENGTH="${SYLOU_MIN_PASSWORD_LENGTH:-15}"
OUT=/tmp/sylou-runtime.js

if [ ! -r "$KEY_FILE" ]; then
  echo "sylou-web: no readable publishable key at $KEY_FILE — run 'sylou setup' first" >&2
  exit 1
fi

KEY="$(tr -d ' \t\r\n' < "$KEY_FILE")"

# Supabase issues publishable keys as sb_publishable_… or as a JWT, whose
# three parts are base64url. Only those characters are accepted, so no value
# that reaches the file below can end the string it is written into.
case "$KEY" in
  "") echo "sylou-web: the publishable key file is empty" >&2; exit 1 ;;
  *[!A-Za-z0-9._-]*) echo "sylou-web: the publishable key holds characters a key never has" >&2; exit 1 ;;
esac
case "$KEY" in
  sb_publishable_?*) : ;;
  ?*.?*.?*) : ;;
  *) echo "sylou-web: the publishable key is not in a shape Supabase issues" >&2; exit 1 ;;
esac

case "$MIN_PASSWORD_LENGTH" in
  "" | *[!0-9]*) echo "sylou-web: SYLOU_MIN_PASSWORD_LENGTH must be a whole number" >&2; exit 1 ;;
esac

printf 'window.__SYLOU__ = { publishableKey: "%s", minPasswordLength: %s };\n' \
  "$KEY" "$MIN_PASSWORD_LENGTH" > "$OUT"

echo "sylou-web: /sylou-runtime.js written (key of ${#KEY} characters, password floor ${MIN_PASSWORD_LENGTH})"
