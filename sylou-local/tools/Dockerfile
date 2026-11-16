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
# network with no way out.
RUN deno cache --lock=/app/deno.lock /app/tools/main.ts \
    && find /app /migrations -type d -exec chmod 755 {} + \
    && find /app /migrations -type f -exec chmod 644 {} +

# Nobody: these commands need no account of their own.
USER 65534:65534

# Deno writes its cache under this; the image's own copy is read-only at run
# time, so point it at the tmpfs.
ENV DENO_DIR=/tmp/deno

ENTRYPOINT ["deno", "run", \
  "--cached-only", \
  "--allow-read=/run/secrets,/migrations,/out,/app", \
  "--allow-write=/out", \
  "--allow-net", \
  "--allow-env", \
  "/app/tools/main.ts"]
