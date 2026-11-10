import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInventoryOpenApiDocument } from "../src/openapi.ts";
import { createCommunityOpenApiDocument } from "../src/community.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const [name, document] of [
  ["inventory.v1", createInventoryOpenApiDocument()],
  ["community.v1", createCommunityOpenApiDocument()],
] as const) {
  const outputPath = resolve(packageRoot, `openapi/${name}.json`);
  const generated = `${JSON.stringify(document, null, 2)}\n`;
  if (process.argv.includes("--check")) {
    const committed = await readFile(outputPath, "utf8").catch(() => "");
    if (committed !== generated) {
      console.error(`${name} OpenAPI artifact is stale. Run: pnpm --dir packages/contracts openapi:generate`);
      process.exitCode = 1;
    } else {
      console.log(`${name} OpenAPI artifact is up to date.`);
    }
  } else {
    await writeFile(outputPath, generated, "utf8");
    console.log(`Generated ${outputPath}`);
  }
}
