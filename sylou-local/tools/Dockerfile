# The Sylou Local tools image: the few jobs an install needs that are not a
# web request — making its secrets, applying the migrations, adding an
# account. One implementation and one test stack (D4), so the scripts on your
# computer only gather facts and call this.
#
# Built from the repository root, whose .dockerignore allow-list decides what
# a build may see:
#   docker build -f sylou-local/tools/Dockerfile -t sylou-tools .
#
# It is the only part of an install that is ever given the database's own
# password, and it runs on the internal network with no way out.

FROM denoland/deno:alpine-2.9.8@sha256:75749604f68aea01d39bead15fd1c86343639e44eb8c58ab051da8a924799d01

# The migrations the install applies: the same files hosted Sylou runs.
COPY supabase/migrations /migrations

WORKDIR /app
COPY sylou-local/deno.json /app/deno.json
COPY sylou-local/deno.lock /app/deno.lock
COPY sylou-local/tools /app/tools

# Every library this image uses, downloaded now and checked against the
# committed lockfile, so a run fetches nothing (D12) — it could not, on a
# network with no way out. `--frozen` stops the build when the tools need a
# library the lockfile does not name, rather than fetching it unpinned.
#
# The cache stays where the image puts it (DENO_DIR, /deno-dir) and is made
# readable by everyone: the container runs as nobody on a read-only
# filesystem, so it can read the cache but write nowhere outside /tmp. Deno
# does not type-check at run time, so it needs no cache of its own.
RUN deno cache --frozen --lock=/app/deno.lock /app/tools/main.ts \
    && find /app /migrations "$DENO_DIR" -type d -exec chmod 755 {} + \
    && find /app /migrations "$DENO_DIR" -type f -exec chmod 644 {} +

# The system packages, brought up to the fixes Alpine has published since the
# base image was made (T50). CI gives PACKAGES_REFRESH a new value on every
# run, so this step is never taken from an earlier build's cache.
ARG PACKAGES_REFRESH
RUN apk upgrade --no-cache

# Nobody: these commands need no account of their own.
USER 65534:65534

ENTRYPOINT ["deno", "run", \
  "--cached-only", \
  "--allow-read=/run/secrets,/migrations,/out,/app,/facts.json", \
  "--allow-write=/out", \
  "--allow-net", \
  "--allow-env", \
  "/app/tools/main.ts"]
