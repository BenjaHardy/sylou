# The Sylou Local functions image: the same eight edge functions hosted Sylou
# runs, each bundled at build time so the install fetches no code while it
# runs — a container with no way out could not fetch it anyway.
#
# Built from the repository root, whose .dockerignore allow-list decides what
# a build may see:
#   docker build -f sylou-local/functions/Dockerfile -t sylou-functions .
#
# No key, address or setting is baked in: the router reads the settings from
# its environment and the keys from the files Docker mounts at /run/secrets.

# ---------------------------------------------------------------------------
# Stage 1: turn each function into one bundle
# ---------------------------------------------------------------------------
FROM supabase/edge-runtime:v1.77.9@sha256:6b850a2ccf0bf50ecac9accff8098095cd191c389c2a53c59b857aa0f53a8343 AS bundle

# The sources, exactly as hosted Sylou deploys them.
COPY supabase/functions /src

# Nothing that is not part of a running function: the tests, the helpers they
# use, and the Node packages they install for themselves.
RUN find /src -name '*.test.ts' -delete \
    && rm -f /src/_shared/_test_support.ts \
    && rm -rf /src/node_modules /src/deno.lock

# One eszip per function, from the entrypoint the router asks for later.
# A checksum is recorded in each bundle, so a changed file is noticed.
RUN mkdir -p /out \
    && for name in analysis chat config context-prompt delete-account editor-action extract-text share-report; do \
         edge-runtime bundle --checksum sha256 \
           --entrypoint "/src/$name/index.ts" \
           --output "/out/$name.eszip" \
         || exit 1; \
       done

# ---------------------------------------------------------------------------
# Stage 2: the runtime, with the bundles and our router
# ---------------------------------------------------------------------------
FROM supabase/edge-runtime:v1.77.9@sha256:6b850a2ccf0bf50ecac9accff8098095cd191c389c2a53c59b857aa0f53a8343

COPY --from=bundle /out /home/deno/eszip
COPY sylou-local/functions/main.ts /home/deno/main/index.ts

# Nobody: the runtime needs no account of its own, and the filesystem is
# read-only at run time with a tmpfs at /tmp.
USER 65534:65534

EXPOSE 9000

# The idle timeout has to outlast a model on this computer taking its time
# before the first word: the functions themselves wait 300 s for one (#247),
# and the worker's own clock is 600 s.
CMD ["start", "--main-service", "/home/deno/main", "--user-worker-request-idle-timeout", "600000"]
