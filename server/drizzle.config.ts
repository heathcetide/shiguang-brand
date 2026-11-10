import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: [
    "./src/storage/database/postgres/schema.generated.ts",
    "./src/storage/database/postgres/schema.extensions.ts",
  ],
  out: "./drizzle",
  strict: true,
  verbose: true,
});
