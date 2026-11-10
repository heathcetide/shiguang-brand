# ──────────────────────────────────────────────
# Dockerfile for ling-base development & testing
# ──────────────────────────────────────────────
# This Dockerfile is for CI/testing the library itself.
# For application scaffolding, use `lingcli new` which generates
# project-specific Dockerfiles.
#
# Usage:
#   docker build -t ling-base-dev .
#   docker run --rm ling-base-dev go test ./...
#   docker run --rm ling-base-dev make check

FROM golang:1.26-bookworm AS base

WORKDIR /app

# Install system dependencies for CGO-based packages (sqlite3, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libc6-dev \
    make \
    git \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Copy go.mod/go.work first for better caching
COPY go.mod go.work ./
COPY go.work.sum* ./

# Copy all module go.mod files for workspace resolution
COPY . .

# Download dependencies
RUN go work sync || true

# ──────────────────────────────────────────────
# Builder stage: compile all modules
# ──────────────────────────────────────────────
FROM base AS builder

RUN go build ./...

# ──────────────────────────────────────────────
# Tester stage: run tests + lint + vuln
# ──────────────────────────────────────────────
FROM base AS tester

# Install golangci-lint
RUN curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh \
    | sh -s -- -b /usr/local/bin v1.62.0

# Install govulncheck
RUN go install golang.org/x/vuln/cmd/govulncheck@latest

# Default: run full check
CMD ["make", "check"]

# ──────────────────────────────────────────────
# lingcli stage: build the CLI tool
# ──────────────────────────────────────────────
FROM base AS cli

RUN cd lingcli && go build -o /usr/local/bin/lingcli .

CMD ["lingcli", "--help"]
