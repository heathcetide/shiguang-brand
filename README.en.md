# Shiwei Daily (拾味日常)

<p align="center">
  <img src="client/assets/logo.svg" alt="Shiwei Daily logo" width="160" />
</p>

<p align="center">
  <strong>Turn what is already in your kitchen into the next meal you can actually cook.</strong>
</p>

<p align="center">
  <a href="README.md">简体中文</a> · English
</p>

Shiwei Daily is an open-source food management application for individuals and small households. Starting with pantry inventory and expiry awareness, it connects recipe matching, shopping, cooking, stock deduction, and diet logging into one verifiable everyday workflow. Health profiles, community content, and safety-bounded AI assistance complement that core experience.

> [!IMPORTANT]
> The mobile client remains in its trusted Beta hardening phase and has not been publicly released. Nutrition estimates and AI output are for everyday reference only and are not medical diagnosis or treatment advice. Beta builds should not be used with real sensitive health data.

## Core experience

```text
Record household ingredients
  → identify available or expiring food
  → match recipes that can actually be cooked
  → finish cooking and deduct inventory
  → confirm actual consumption and create a diet record
```

The repository currently includes:

- Household inventory, expiry dates, kitchenware, and shopping lists
- Recipe matching based on inventory, expiring food, allergens, and available equipment
- A cooking queue and step mode with idempotent stock deduction and diet logging
- Nutrition intake, health profiles, reminders, and trend insights
- Recipe search, favorites, submissions, follows, and community content
- AI nutrition Q&A, ingredient and meal recognition, receipt scanning, and voice interaction
- An admin console for users, recipes, community content, Agent runs, AI configuration, and security audits

## Project status

See the [status and evidence index](docs/status.md) for issue tracking, build results, deployment records, and device acceptance. These are separate milestones: merged code or a successful build does not establish deployment or real-device acceptance.

[Main CI](https://github.com/AdlinZ/DietDigiDose/actions/workflows/ci.yml?query=branch%3Amain) · [Android APK builds](https://github.com/AdlinZ/DietDigiDose/actions/workflows/android-apk.yml) · [Open milestones](https://github.com/AdlinZ/DietDigiDose/milestones)

## Live services

| Entry | URL |
| --- | --- |
| Admin console | [dietdigidose.top/login](https://dietdigidose.top/login) |
| API health check | [dietdigidose.top/api/v1/health](https://dietdigidose.top/api/v1/health) |

The `admin` app is an administration-only frontend. Its root URL enters the protected console: signed-out visitors are redirected to `/login`, and verified administrators reach `/admin`. Former public-site URLs also redirect to the admin entry; promotional pages and website-only settings have been removed.

## Architecture

This repository is a pnpm workspace monorepo:

| Package | Main technologies | Purpose |
| --- | --- | --- |
| `client` | Expo 54, React Native, Expo Router, Uniwind | iOS, Android, and web client |
| `server` | Go, Gin | Sole API runtime (local default :9090) |
| `admin` | React, Vite, Tailwind CSS | Moderation and system administration console |
| `deploy` | Docker Compose, Caddy | HTTPS deployment, persistence, and recovery exercises |

Local development uses SQLite under `data/` by default; deployment supports PostgreSQL. Supabase is optional object storage for community media. Environment-specific evidence belongs in the [status index](docs/status.md).

## Repository layout

```text
shiwei-daily/
├── client/          # Expo routes, screens, components, and assets
├── server/       # Go API runtime
├── admin/           # React administration console
├── data/            # Local SQLite / JWT (gitignored)
├── deploy/          # Staging deployment, proxy, and smoke-test configuration
├── docs/            # Product roadmap, acceptance checklists, and operations docs
├── eslint-plugins/  # Project-specific ESLint rules
└── scripts/         # Workspace and release validation scripts
```

## Quick start

<!-- BEGIN GENERATED:toolchain -->
### Requirements

- Node.js 22.23.2 (source: [.nvmrc](.nvmrc))
- pnpm 10.18.0 (source: [package.json](package.json))

### Install and configure

```bash
corepack enable
corepack prepare pnpm@10.18.0 --activate
pnpm install --frozen-lockfile
cp client/.env.example client/.env
```
<!-- END GENERATED:toolchain -->

When using nvm, fnm, mise, or asdf, load the repository's Node version files first. Regular CI, Android builds, and the recommended local environment must use the same Node version; upgrades must update the version files, root package `engines`, and all workflows in one PR.

At minimum, point the client to the local API:

```dotenv
EXPO_PUBLIC_BACKEND_BASE_URL=http://localhost:9090
```

Development mode can use the default SQLite database under `data/` and generate a local JWT secret automatically. Production and staging must define a strong `JWT_SECRET`, `ADMIN_INITIAL_PASSWORD`, and explicit `CORS_ORIGINS`, and connect to persistent PostgreSQL using `DATABASE_DRIVER=postgresql` and `DATABASE_URL`. See [`server/configs/config.yaml`](server/configs/config.yaml) and deploy env examples.

### Run

Start Expo Web and the Go API (:9090):

```bash
pnpm dev
```

Start the admin console in another terminal:

```bash
pnpm dev:admin
```

Use `pnpm dev:all` for client + Go + admin logs in one terminal.

| Service | Default URL |
| --- | --- |
| Expo Web | `http://localhost:8080` |
| API (Go) | `http://localhost:9090` |
| Health check | `http://localhost:9090/api/v1/health` |
| Admin console | `http://localhost:5173` |

Runtime notes: [docs/server-migration.md](docs/server-migration.md).

The local SQLite database defaults to `data/dietdigidose.db` (gitignored).

## Common commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the client and Go API |
| `pnpm dev:server` | Start only the Go API |
| `pnpm dev:admin` | Start the admin console |
| `pnpm dev:all` | Start the client, Go API, and admin console |
| `pnpm lint:all` | Check `client`, `admin`, and Go |
| `bun run test:brand` | Verify display branding, shared logos, and native icon configuration |
| `pnpm test:all` | Run all automated tests |
| `pnpm test:coverage` | Run client coverage gates |
| `pnpm test:stability` | Run the full test suite twice and generate a stability report |
| `pnpm build:client` | Export the Expo web build |
| `pnpm build:go` | Build the Go API |
| `pnpm build:admin` | Build the admin console |
| `pnpm validate:toolchain` | Validate Node/pnpm versions against CI declarations |
| `pnpm validate:release` | Validate versions, snapshot, and native build numbers |
| `pnpm audit:prod` | Audit production dependencies |
| `pnpm docs:generate` | Refresh generated README toolchain blocks |
| `pnpm docs:check` | Check README drift, local link targets, and listed commands |

See [layered testing and quality gates](docs/testing.md) for test layers, coverage, artifact budgets, and flaky/quarantine handling.

## Release and security boundary

`client/eas.json` contains iOS and Android preview and production profiles, and every distributable build requires an HTTPS API. Only local simulator development may explicitly use localhost HTTP, and it must not use real sensitive data.

A passing dependency audit does not mean “zero vulnerabilities.” The current audit exceptions and dependency patches are defined in [`pnpm-workspace.yaml`](pnpm-workspace.yaml); rationale, regression checks, and review requirements belong in [layered testing and quality gates](docs/testing.md). Review them after every dependency upgrade and before candidate acceptance.

Read these documents before deployment:

- [Development and Beta hardening checklist](TODO.md)
- [Product roadmap](docs/product-roadmap.md)
- [Operations and recovery guide](docs/operations.md)
- [Security policy](SECURITY.md)

## Data and third-party content

The project can import data from HowToCook, Open Food Facts, Wikibooks, USDA, and the Taiwan FDA. Imported records must retain source URLs, versions, and license metadata. Never commit local databases, backups containing user data, or real secrets.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for bundled source code, fonts, and recipe data. License copies are stored in [`LICENSES/`](LICENSES/).

## Project history

The Shiwei Daily concept originated during a 2025 university software innovation competition. It received first prize in the Southwest regional round and third prize nationally in the [Software Design Innovation category of the 18th National College Student Software Innovation Competition](https://www.swcontest.com.cn/information?activeTab=notice&detailId=d6d9f4a293ba48f59cec8824ca901332).

The project was originally named 食光烙记 and is now called Shiwei Daily (拾味日常), with a terracotta bowl and sage-green steam/bookmark logo. It restarted in 2026 with a new codebase. The [earlier competition repository](https://github.com/heathcetide/shiguang-brand) is preserved as historical material. The current implementation retains the problem context and product vision, while its architecture, data model, name, and visual identity have been redesigned.

Existing domains, repository URLs, Expo project/slug, native application IDs, URI scheme, internal module namespaces, JWT issuer, database names, and deployment identities remain compatible with existing installations, links, and stored data. They are technical identifiers, not the current display brand. This rebrand does not migrate infrastructure, change signing keys, or deploy services.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes. Report security issues privately according to [SECURITY.md](SECURITY.md); do not publicly disclose an exploitable vulnerability.

## License

Project-owned source code is available under the [MIT License](LICENSE). Third-party components and content remain subject to their respective licenses.
