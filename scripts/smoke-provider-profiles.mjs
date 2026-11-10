import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

for (const profile of ["china", "global"]) {
  const result = spawnSync(pnpm, ["--dir", "client", "exec", "expo", "config", "--type", "public", "--json"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      EAS_BUILD_PROFILE: `${profile}-preview`,
      EXPO_PUBLIC_DEPLOYMENT_PROFILE: profile,
      EXPO_PUBLIC_BACKEND_BASE_URL: `https://${profile}.api.example.test`,
      EXPO_PUBLIC_ALLOW_INSECURE_HTTP: "0",
    },
  });
  if (result.status !== 0) {
    throw new Error(`${profile} Expo config failed:\n${result.stdout}\n${result.stderr}`);
  }
  const config = JSON.parse(result.stdout);
  if (config.extra?.deploymentProfile !== profile) throw new Error(`${profile} profile was not retained in public Expo config`);
  const serialized = JSON.stringify(config);
  for (const secret of ["SUPABASE_SERVICE_ROLE_KEY", "ALIYUN_ACCESS_KEY_SECRET", "JWT_SECRET"]) {
    if (serialized.includes(secret)) throw new Error(`${profile} public Expo config leaked ${secret}`);
  }
  console.log(`${profile} provider profile: Expo public config smoke passed`);
}
