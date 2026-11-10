import { createPostgresBackup,inspectPostgresBackup,restorePostgresBackup } from "../src/services/backup/postgres.js";
const [operation,directory] = process.argv.slice(2);
async function main() {
  if (!directory) throw new Error("Usage: pnpm db:postgres:backup <directory> | db:postgres:inspect <directory> | db:postgres:restore <directory>");
  if (operation==="inspect") return inspectPostgresBackup(directory);
  if (operation==="backup") {
    if (!process.env.DATABASE_BACKUP_URL) throw new Error("DATABASE_BACKUP_URL is required");
    return createPostgresBackup(process.env.DATABASE_BACKUP_URL,directory,{ owner: process.env.BACKUP_OWNER || "",candidateSha: process.env.CANDIDATE_GIT_SHA || "" });
  }
  if (operation==="restore") {
    if (!process.env.DATABASE_RESTORE_URL) throw new Error("DATABASE_RESTORE_URL must identify an empty isolated target");
    return restorePostgresBackup(process.env.DATABASE_RESTORE_URL,directory);
  }
  throw new Error("Unknown backup operation");
}
main().then(result => console.log(JSON.stringify(result,null,2))).catch(error => {
  let message = error instanceof Error ? error.message : String(error);
  for (const value of [process.env.DATABASE_BACKUP_URL,process.env.DATABASE_RESTORE_URL]) if (value) message = message.split(value).join("[redacted connection]");
  console.error(JSON.stringify({ success: false,error: message })); process.exitCode=1;
});
