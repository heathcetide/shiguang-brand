import * as esbuild from 'esbuild';
import { createRequire } from 'module';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');
const rootPkg = require('../package.json');
const dependencies = pkg.dependencies || {};
const externalList = Object.keys(dependencies).filter(dep => dep !== 'dayjs' && dep !== '@dietdigidose/contracts');
const gitSha = process.env.SERVER_GIT_SHA?.trim() || '';
if (gitSha && !/^[a-f0-9]{40}$/.test(gitSha)) {
  throw new Error('SERVER_GIT_SHA must be a full lowercase 40-character commit SHA');
}
try {
  rmSync(new URL('./dist/', import.meta.url), { recursive: true, force: true });
  await esbuild.build({
    entryPoints: {
      index: 'src/index.ts',
      worker: 'src/worker.ts',
      'database-backup': 'scripts/database-backup.ts',
      'postgres-backup': 'scripts/postgres-backup.ts',
      'database-rehearsal': 'scripts/database-rehearsal.ts',
      'migrate-community-media': 'scripts/migrate-community-media.ts',
      'apply-postgres-schema': 'scripts/apply-postgres-schema.ts',
    },
    bundle: true,
    splitting: true,
    minifySyntax: true,
    // Compact formatting only; retain identifiers and esbuild's legal comments.
    minifyWhitespace: true,
    platform: 'node',
    format: 'esm',
    outdir: 'dist',
    external: externalList,
    define: {
      'process.env.SERVER_VERSION': JSON.stringify(process.env.SERVER_VERSION || rootPkg.version),
      'process.env.SERVER_BUILD_TIME': JSON.stringify(process.env.SERVER_BUILD_TIME || new Date().toISOString()),
      'process.env.SERVER_GIT_SHA': JSON.stringify(gitSha),
    },
  });
  console.log('⚡ Build complete!');
} catch (e) {
  console.error(e);
  process.exit(1);
}
