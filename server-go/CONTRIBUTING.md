# 贡献指南

感谢你对 DietDigiDose 的兴趣！本文档介绍如何参与项目开发。

## 开发环境

- Go 1.23+
- Make（可选，用于快捷命令）
- Docker & Docker Compose（可选，用于本地依赖服务）

## 快速开始

```bash
# 克隆仓库
git clone <repo-url>
cd DietDigiDose

# 安装依赖
make tidy

# 启动本地依赖服务（MySQL + Redis）
make docker-up

# 运行项目
make run

# 运行测试
make test

# 代码检查
make lint
```

## 代码规范

1. **代码格式**: 提交前运行 `make fmt`
2. **静态检查**: 运行 `make vet` 和 `make lint`
3. **测试覆盖**: 新功能需附带测试，运行 `make test-cover` 查看覆盖率
4. **提交信息**: 遵循 [Conventional Commits](https://www.conventionalcommits.org/)

### 提交信息格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

**type** 类型:
- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档变更
- `style`: 代码格式（不影响功能）
- `refactor`: 重构（非新功能、非修复）
- `perf`: 性能优化
- `test`: 测试相关
- `chore`: 构建/工具变更

示例:
```
feat(handlers): 新增用户列表分页查询
fix(config): 修复 YAML 配置加载时端口覆盖问题
docs(readme): 更新部署说明
```

## 分支策略

- `main`: 生产分支，保持稳定
- `develop`: 开发分支（如有）
- `feature/*`: 功能分支
- `fix/*`: 修复分支
- `release/*`: 发布分支

## PR 流程

1. 从 `main` 创建功能分支: `git checkout -b feature/your-feature`
2. 编写代码 + 测试
3. 确保通过所有检查: `make vet && make lint && make test`
4. 提交并推送: `git push origin feature/your-feature`
5. 创建 Pull Request，描述变更内容
6. 等待 Code Review 通过后合并

## 目录结构

```
DietDigiDose/
├── cmd/server/           # 程序入口
├── internal/
│   ├── configs/          # 配置定义与加载
│   ├── handlers/         # 路由注册 + handler 实现
│   ├── middlewares/      # 项目特定中间件
│   └── models/           # 数据模型
├── configs/              # 配置文件
├── migrations/           # 数据库迁移 SQL
├── docker/               # Docker 部署文件
├── docs/                 # 项目文档
├── scripts/              # 辅助脚本
└── Makefile
```

## 问题反馈

- Bug 报告: 创建 Issue 并描述复现步骤
- 功能建议: 创建 Issue 并说明使用场景
- 安全漏洞: 请勿公开 Issue，直接联系维护者
