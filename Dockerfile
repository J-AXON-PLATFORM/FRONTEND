FROM node:24.21.0-alpine3.24@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24.21.0-alpine3.24@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6

ARG VCS_REF=unknown

LABEL org.opencontainers.image.title="J-AXON Frontend" \
      org.opencontainers.image.description="J-AXON web frontend" \
      org.opencontainers.image.version="0.1.0" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.source="https://github.com/J-AXON-PLATFORM/FRONTEND"

RUN apk add --no-cache libstdc++ musl=1.2.6-r3 musl-utils=1.2.6-r3 zlib=1.4-r0 && \
    addgroup --system --gid 10001 jaxon && \
    adduser --system --uid 10001 --ingroup jaxon --home /app --shell /sbin/nologin jaxon

WORKDIR /app

COPY --from=dependencies /usr/local/bin/node /usr/local/bin/node
COPY --from=build --chown=jaxon:jaxon /app/.next/standalone ./
COPY --from=build --chown=jaxon:jaxon /app/.next/static ./.next/static

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

EXPOSE 3000

USER 10001:10001

ENTRYPOINT ["node", "server.js"]
