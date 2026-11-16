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

FROM node:24-trixie-slim@sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446 AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npx vite build --mode package

FROM nginx/nginx-unprivileged:stable-alpine@sha256:c3fc8fa482be50ef709c6438eb1bc98d50dbfe5a9b48be90711b8814f4dfd701
# The image's own example server is not included by our nginx.conf; removing
# it keeps the start-up scripts from finding anything to edit.
USER root
RUN rm -f /etc/nginx/conf.d/default.conf
USER 101

COPY --from=build /app/dist /usr/share/nginx/html
COPY sylou-local/web/nginx.conf /etc/nginx/nginx.conf
COPY sylou-local/web/headers.conf /etc/nginx/sylou/headers.conf
# The same image serves as the gateway inside Docker, started with this config
# instead of the door's: `nginx -c /etc/nginx/sylou/gateway.conf`.
COPY sylou-local/web/gateway.conf /etc/nginx/sylou/gateway.conf
COPY --chmod=555 sylou-local/web/docker-entrypoint.d/40-sylou-runtime.sh /docker-entrypoint.d/40-sylou-runtime.sh

EXPOSE 8080
