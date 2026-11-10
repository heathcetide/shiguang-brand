# Server test runner portability

The full server suite uses `node --import tsx --test --test-concurrency=1 test/**/*.test.ts` with the pinned Node 22.23.2 toolchain. This is tsx's supported Node loader entry point, not an alternate test implementation.

The `tsx` CLI also launches Node with the same loader, but first creates a Unix-domain IPC socket for its wrapper signal relay. Restricted cloud runners can reject that socket before any tests start. The direct loader avoids that wrapper process and its preflight IPC/signal wiring. It also omits the preflight's historical warning filters, leaving normal Node warnings visible; the loader still registers both CommonJS and ESM TypeScript support. The explicit test operands, single-worker concurrency, environment, Node test isolation and assertions are unchanged. No permissions, warning filters, skips or failure handling are relaxed.

Node receives termination signals directly rather than through the tsx wrapper. CI still observes Node's normal test exit status and signal termination. These tests do not use tsx watch, REPL or CLI-only options. Other server commands are unchanged.

References:
- https://github.com/privatenumber/tsx/blob/v4.21.0/src/run.ts
- https://github.com/privatenumber/tsx/blob/v4.21.0/src/cli.ts
- https://github.com/privatenumber/tsx/blob/master/docs/dev-api/node-cli.md

Earlier official stability attempts that stopped at the tsx IPC startup remain failures. Only a fresh successful full `pnpm test:stability` run validates the updated entry point.
