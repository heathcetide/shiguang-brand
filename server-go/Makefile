# DietDigiDose Makefile

APP := DietDigiDose
VERSION := $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
BUILD_TIME := $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")
GIT_COMMIT := $(shell git rev-parse --short HEAD 2>/dev/null || echo "none")
LDFLAGS := -X main.Version=$(VERSION) -X main.BuildTime=$(BUILD_TIME) -X main.GitCommit=$(GIT_COMMIT)

.DEFAULT_GOAL := help

.PHONY: all build run dev debug test test-race test-cover coverage-badge benchmark vet lint fmt fmt-check tidy vuln clean docker-build docker-up docker-down dev-deps seed migrate migrate-down migrate-status release release-patch release-minor release-major help

all: build

## build: 编译项目
build:
	go build -ldflags "$(LDFLAGS)" -o bin/$(APP) ./cmd/...

## run: 本地运行
run:
	go run -ldflags "$(LDFLAGS)" ./cmd/...

## dev: 热重载运行（需要 air: go install github.com/air-verse/air@latest）
dev:
	@command -v air >/dev/null 2>&1 || { echo "请先安装 air: go install github.com/air-verse/air@latest"; exit 1; }
	air

## debug: Delve 调试（需要 dlv: go install github.com/go-delve/delve/cmd/dlv@latest）
debug:
	@command -v dlv >/dev/null 2>&1 || { echo "请先安装 dlv: go install github.com/go-delve/delve/cmd/dlv@latest"; exit 1; }
	dlv debug ./cmd/...

## test: 运行测试
test:
	go test -v -count=1 ./...

## test-race: 竞态检测
test-race:
	go test -v -race -count=1 ./...

## test-cover: 测试覆盖率
test-cover:
	go test -race -coverprofile=coverage.txt -covermode=atomic ./...
	go tool cover -func=coverage.txt

## coverage-badge: 生成覆盖率徽章（供 README 引用）
coverage-badge:
	@go test -coverprofile=coverage.txt -covermode=atomic ./... 2>/dev/null
	@COV=$$(go tool cover -func=coverage.txt | grep total | awk '{print $$3}' | sed 's/%//'); \
	INT=$$(echo $$COV | cut -d. -f1); \
	if [ $$INT -ge 80 ]; then COLOR=brightgreen; \
	elif [ $$INT -ge 60 ]; then COLOR=yellow; \
	elif [ $$INT -ge 40 ]; then COLOR=orange; \
	else COLOR=red; fi; \
	echo "覆盖率: $$COV% → $$COLOR"; \
	echo "![coverage](https://img.shields.io/badge/coverage-$${COV}%25-$$COLOR)" > coverage-badge.md

## benchmark: 基准测试
benchmark:
	go test -bench=. -benchmem -count=3 ./...

## vet: 静态检查
vet:
	go vet ./...

## lint: golangci-lint（需先安装）
lint:
	@command -v golangci-lint >/dev/null 2>&1 || { echo "请先安装 golangci-lint: https://golangci-lint.run/usage/install/"; exit 1; }
	golangci-lint run ./...

## fmt: 格式化代码
fmt:
	go fmt ./...

## fmt-check: 检查格式化
fmt-check:
	@test -z "$$(gofmt -l .)" || (echo "需要运行 make fmt" && exit 1)

## tidy: 整理依赖
tidy:
	go mod tidy

## vuln: 漏洞扫描（需要 govulncheck: go install golang.org/x/vuln/cmd/govulncheck@latest）
vuln:
	@command -v govulncheck >/dev/null 2>&1 || { echo "请先安装 govulncheck: go install golang.org/x/vuln/cmd/govulncheck@latest"; exit 1; }
	govulncheck ./...

## clean: 清理构建产物
clean:
	rm -rf bin/ dist/ coverage.txt coverage-badge.md data/

## docker-build: 构建 Docker 镜像
docker-build:
	docker build -f docker/Dockerfile -t $(APP):$(VERSION) .

## docker-up: 启动完整 Docker Compose（app + mysql + redis）
docker-up:
	docker compose -f docker/docker-compose.yml --profile full up -d

## docker-down: 停止 Docker Compose
docker-down:
	docker compose -f docker/docker-compose.yml --profile full down

## dev-deps: 只启动开发依赖（mysql + redis，不启动 app）
dev-deps:
	docker compose -f docker/docker-compose.yml --profile dev up -d

## seed: 插入示例数据（方便开发调试）
seed:
	@echo "==> 插入示例数据..."
	@go run -ldflags "$(LDFLAGS)" ./cmd/... -seed 2>/dev/null || \
		echo "提示: 在 cmd/server/main.go 中实现 -seed flag 或手动执行 SQL:"
	@echo "  INSERT INTO users (name, email, phone) VALUES"
	@echo "    ('Alice', 'alice@example.com', '13800000001'),"
	@echo "    ('Bob',   'bob@example.com',   '13800000002'),"
	@echo "    ('Carol', 'carol@example.com', '13800000003');"

## migrate: 执行数据库迁移
migrate:
	@bash scripts/migrate.sh up

## migrate-down: 回滚数据库迁移
migrate-down:
	@bash scripts/migrate.sh down

## migrate-status: 查看迁移状态
migrate-status:
	@bash scripts/migrate.sh status

## release: 打 tag 并推送（用法: make release v=v1.0.0）
release:
	@test -n "$(v)" || (echo "用法: make release v=v1.0.0" && exit 1)
	git tag -a $(v) -m "Release $(v)"
	git push origin $(v)

## release-patch: 自动打 patch 版本 tag（v1.0.0 → v1.0.1）
release-patch:
	@bash -c 'CURRENT=$$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0"); \
	MAJOR=$$(echo $$CURRENT | sed "s/v//;s/\..*//"); \
	MINOR=$$(echo $$CURRENT | sed "s/v[0-9]*\.//;s/\..*//"); \
	PATCH=$$(echo $$CURRENT | sed "s/v[0-9]*\.[0-9]*\.//"); \
	NEXT=v$$MAJOR.$$MINOR.$$((PATCH+1)); \
	echo "→ 打 tag: $$NEXT"; \
	git tag -a $$NEXT -m "Release $$NEXT"; \
	git push origin $$NEXT'

## release-minor: 自动打 minor 版本 tag（v1.0.0 → v1.1.0）
release-minor:
	@bash -c 'CURRENT=$$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0"); \
	MAJOR=$$(echo $$CURRENT | sed "s/v//;s/\..*//"); \
	MINOR=$$(echo $$CURRENT | sed "s/v[0-9]*\.//;s/\..*//"); \
	NEXT=v$$MAJOR.$$((MINOR+1)).0; \
	echo "→ 打 tag: $$NEXT"; \
	git tag -a $$NEXT -m "Release $$NEXT"; \
	git push origin $$NEXT'

## release-major: 自动打 major 版本 tag（v1.0.0 → v2.0.0）
release-major:
	@bash -c 'CURRENT=$$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0"); \
	MAJOR=$$(echo $$CURRENT | sed "s/v//;s/\..*//"); \
	NEXT=v$$((MAJOR+1)).0.0; \
	echo "→ 打 tag: $$NEXT"; \
	git tag -a $$NEXT -m "Release $$NEXT"; \
	git push origin $$NEXT'

## help: 显示此帮助
help:
	@echo "用法: make <target>"
	@echo ""
	@echo "可用命令:"
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/^## //;s/:/\n    /' | \
		awk 'NR%2==1 {printf "  \033[36m%-20s\033[0m", $$1} NR%2==0 {printf "  %s\n", $$1}'
