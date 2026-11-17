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
# Stage 1: the functions' libraries, held to the committed lockfile
#
# sylou-local/functions/deno.lock names every package the eight functions
# load, each with its hash (D12), and deno.json beside it takes supabase-js
# from npm, where a published package never changes; hosted deploys read
# neither file. `--frozen` stops the build when the functions need anything
# the lockfile does not name, so a new import cannot come in unpinned. After
# a change to the functions' imports, write it afresh: `deno task
# lock:functions` in sylou-local/.
# ---------------------------------------------------------------------------
FROM denoland/deno:alpine-2.9.8@sha256:75749604f68aea01d39bead15fd1c86343639e44eb8c58ab051da8a924799d01 AS locked

COPY supabase/functions /src
COPY sylou-local/functions/deno.json /src/deno.json
COPY sylou-local/functions/deno.lock /src/deno.lock
RUN cd /src \
    && deno cache --frozen --node-modules-dir=none --lock=/src/deno.lock /src/*/index.ts \
    || { echo "sylou-local/functions/deno.lock is out of date: run 'deno task lock:functions' in sylou-local/" >&2; exit 1; }

# The licence files of every package that lockfile names, from the copies
# just fetched and checked against it, for the image's /licenses.
COPY sylou-local/licenses/collect.mjs /collect.mjs
RUN deno run --allow-read --allow-write=/licenses /collect.mjs \
      deno /src/deno.lock "$DENO_DIR/npm/registry.npmjs.org" /licenses/third-party

# ---------------------------------------------------------------------------
# Stage 2: turn each function into one bundle
# ---------------------------------------------------------------------------
FROM supabase/edge-runtime:v1.77.9@sha256:6b850a2ccf0bf50ecac9accff8098095cd191c389c2a53c59b857aa0f53a8343 AS bundle

# The sources, exactly as hosted Sylou deploys them.
COPY supabase/functions /src

# Nothing that is not part of a running function: the tests, the helpers they
# use, and the Node packages they install for themselves.
RUN find /src -name '*.test.ts' -delete \
    && rm -f /src/_shared/_test_support.ts \
    && rm -rf /src/node_modules

# The settings and lockfile stage 1 checked. The bundler finds the lockfile
# beside deno.json and refuses any package whose hash differs from it.
COPY --from=locked /src/deno.json /src/deno.json
COPY --from=locked /src/deno.lock /src/deno.lock

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
# Stage 3: the runtime, with the bundles and our router
# ---------------------------------------------------------------------------
FROM supabase/edge-runtime:v1.77.9@sha256:6b850a2ccf0bf50ecac9accff8098095cd191c389c2a53c59b857aa0f53a8343

COPY --from=bundle /out /home/deno/eszip
# The router keeps its place in the repository, beside the one shared file
# it reads - the functions' own reading of the local-only switch.
COPY sylou-local/functions/main.ts /home/deno/sylou-local/functions/index.ts
COPY supabase/functions/_shared/_local_only.ts /home/deno/supabase/functions/_shared/_local_only.ts

# The system packages, brought up to the fixes Debian has published since the
# base image was made (T50). CI gives PACKAGES_REFRESH a new value on every
# run, so this step is never taken from an earlier build's cache.
ARG PACKAGES_REFRESH
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Sylou's licences, those of the packages the functions use, and two that
# ship without one: the edge runtime's own, and PDF.js's, which unpdf bundles.
# sylou-local/NOTICE says where the rest of this image's licences are.
COPY LICENSE LICENSE-METHODOLOGY LICENSING.md sylou-local/NOTICE /licenses/
COPY --from=locked /licenses/third-party /licenses/third-party
COPY sylou-local/licenses/edge-runtime /licenses/third-party/edge-runtime
COPY sylou-local/licenses/pdf.js /licenses/third-party/pdf.js

# Nobody: the runtime needs no account of its own, and the filesystem is
# read-only at run time with a tmpfs at /tmp.
USER 65534:65534

# What this image is. A release sets the version, revision and date.
LABEL maintainer="" \
      org.opencontainers.image.title="Sylou Local functions" \
      org.opencontainers.image.description="Sylou's eight edge functions for Sylou Local, bundled into Supabase's edge runtime" \
      org.opencontainers.image.source="https://github.com/BenjaHardy/sylou" \
      org.opencontainers.image.url="https://github.com/BenjaHardy/sylou" \
      org.opencontainers.image.licenses="AGPL-3.0-only AND CC-BY-SA-4.0" \
      org.opencontainers.image.version="dev" \
      org.opencontainers.image.revision="" \
      org.opencontainers.image.created=""

EXPOSE 9000

# The idle timeout has to outlast a model on this computer taking its time
# before the first word: the functions themselves wait 300 s for one (#247),
# and the worker's own clock is 600 s.
CMD ["start", "--main-service", "/home/deno/sylou-local/functions", "--user-worker-request-idle-timeout", "600000"]
