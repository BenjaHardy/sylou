# The Sylou Local web image: the app, built for a package install, served by
# nginx as a non-root user on a read-only filesystem.
#
# Built from the repository root, whose .dockerignore allow-list decides what
# a build may see:
#   docker build -f sylou-local/web/Dockerfile -t sylou-web .
#
# No build argument carries this install's address or key. The app reads both
# at run time (src/lib/runtime-config.ts): the address is the page's own
# origin, and the key is written into /sylou-runtime.js at start-up from the
# key file the container is given.
#
# Run it with a tmpfs at /tmp, the key file mounted, and nothing else:
#   docker run --read-only --tmpfs /tmp \
#     -v ./config/secrets/publishable_key:/run/secrets/publishable_key:ro sylou-web

FROM node:24-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0 AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npx vite build --mode package
# The licence files of the packages the app is built from, for /licenses.
RUN node sylou-local/licenses/collect.mjs npm package-lock.json /app /licenses/third-party

FROM nginx/nginx-unprivileged:stable-alpine@sha256:0c53a1f2890c3526bfd201440f0fd3970e5b78f80630f58284aad0d34b5ec7bd
# The image's own example server is not included by our nginx.conf; removing
# it keeps the start-up scripts from finding anything to edit.
USER root
RUN rm -f /etc/nginx/conf.d/default.conf
# The system packages, brought up to the fixes Alpine has published since the
# base image was made (T50). CI gives PACKAGES_REFRESH a new value on every
# run, so this step is never taken from an earlier build's cache.
ARG PACKAGES_REFRESH
RUN apk upgrade --no-cache
USER 101

COPY --from=build /app/dist /usr/share/nginx/html
COPY sylou-local/web/nginx.conf /etc/nginx/nginx.conf
COPY sylou-local/web/headers.conf /etc/nginx/sylou/headers.conf
# The same image serves as the gateway inside Docker, started with this config
# instead of the door's: `nginx -c /etc/nginx/sylou/gateway.conf`.
COPY sylou-local/web/gateway.conf /etc/nginx/sylou/gateway.conf
COPY --chmod=555 sylou-local/web/docker-entrypoint.d/40-sylou-runtime.sh /docker-entrypoint.d/40-sylou-runtime.sh

# Sylou's licences, and those of the packages the app is built from;
# sylou-local/NOTICE says where the rest of this image's licences are.
COPY LICENSE LICENSE-METHODOLOGY LICENSING.md THIRD_PARTY_LICENSES.md sylou-local/NOTICE /licenses/
COPY --from=build /licenses/third-party /licenses/third-party

# What this image is. Without these it would carry nginx's own labels, and
# describe nginx. A release sets the version, revision and date.
LABEL maintainer="" \
      org.opencontainers.image.title="Sylou Local web" \
      org.opencontainers.image.description="Sylou's pages, front door and gateway for Sylou Local, served by nginx" \
      org.opencontainers.image.source="https://github.com/BenjaHardy/sylou" \
      org.opencontainers.image.url="https://github.com/BenjaHardy/sylou" \
      org.opencontainers.image.licenses="AGPL-3.0-only AND CC-BY-SA-4.0" \
      org.opencontainers.image.version="dev" \
      org.opencontainers.image.revision="" \
      org.opencontainers.image.created=""

EXPOSE 8080
