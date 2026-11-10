# ---- 构建阶段 ----
FROM golang:1.23-alpine AS builder

WORKDIR /build

# 安装 git（用于 git describe 获取版本号）
RUN apk add --no-cache git

# 缓存依赖
COPY go.mod go.sum ./
RUN go mod download

# 复制源码
COPY . .

# 构建参数
ARG VERSION=dev
ARG BUILD_TIME
ARG GIT_COMMIT

# 构建（注入版本信息）
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags="-s -w -X main.Version=${VERSION} -X main.BuildTime=${BUILD_TIME} -X main.GitCommit=${GIT_COMMIT}" \
    -o /app ./cmd/...

# ---- 运行阶段 ----
FROM alpine:3.20

# OCI 标准 LABEL
LABEL org.opencontainers.image.title="DietDigiDose" \
      org.opencontainers.image.description="HTTP REST API 服务，基于 ling-base bootstrap 框架。" \
      org.opencontainers.image.source="https://github.com/heathcetide/DietDigiDose" \
      org.opencontainers.image.version="${VERSION:-dev}" \
      org.opencontainers.image.revision="${GIT_COMMIT:-unknown}" \
      org.opencontainers.image.created="${BUILD_TIME}" \
      org.opencontainers.image.licenses="MIT"

RUN apk --no-cache add ca-certificates tzdata curl

# 创建非 root 用户
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app
COPY --from=builder /app /app/app
COPY --from=builder /build/configs /app/configs

# 确保非 root 用户有执行权限
RUN chown -R appuser:appgroup /app
USER appuser

ENV TZ=Asia/Shanghai
ENV APP_APP_ENVIRONMENT=prod

EXPOSE 8080

# 健康检查（每 30s 探测一次 /health）
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

ENTRYPOINT ["/app/app"]
