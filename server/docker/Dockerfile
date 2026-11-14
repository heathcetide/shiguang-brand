# Build from repository root: docker build -f server/docker/Dockerfile .
FROM golang:1.25.1-alpine AS builder
WORKDIR /build
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
ARG VERSION=dev
ARG BUILD_TIME=unknown
ARG SERVER_GIT_SHA=none
RUN CGO_ENABLED=0 go build -trimpath \
    -ldflags="-s -w -X main.Version=${VERSION} -X main.BuildTime=${BUILD_TIME} -X main.GitCommit=${SERVER_GIT_SHA}" \
    -o /out/server ./cmd/server

FROM alpine:3.22
ARG SERVER_GIT_SHA=none
LABEL org.opencontainers.image.title="Shiwei Daily Go API" \
      org.opencontainers.image.source="https://github.com/heathcetide/DietDigiDose" \
      org.opencontainers.image.revision="${SERVER_GIT_SHA}"
RUN apk add --no-cache ca-certificates tzdata curl \
    && addgroup -S app && adduser -S app -G app \
    && mkdir -p /app/logs /app/uploads /data/media \
    && chown -R app:app /app /data
WORKDIR /app
COPY --from=builder /out/server /app/server
COPY --from=builder /build/configs /app/configs
COPY --from=builder /build/i18n /app/i18n
USER app
ENV TZ=Asia/Shanghai APP_APP_ENVIRONMENT=prod APP_SERVER_PORT=9090 APP_DATABASE_AUTO_MIGRATE=0 APP_EMBEDDED_WORKER_ENABLED=0
EXPOSE 9090
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:9090/api/v1/health || exit 1
ENTRYPOINT ["/app/server"]
