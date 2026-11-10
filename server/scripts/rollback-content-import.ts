import { initDatabase, db } from "../src/storage/db.js";
import { rollbackImportBatch, type ImportKind } from "../src/services/importGovernance.js";

const kind = process.argv[2] as ImportKind | undefined;
const batchId = process.argv[3];

if (!kind || !["ingredient", "recipe"].includes(kind) || !batchId) {
  console.error("用法：pnpm --dir server import:rollback -- ingredient|recipe <batch-id>");
  process.exitCode = 1;
} else {
  try {
    initDatabase();
    console.log(JSON.stringify(rollbackImportBatch(kind, batchId), null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
