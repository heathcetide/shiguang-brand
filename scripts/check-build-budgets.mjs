import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const budgetsPath = path.join(root, "quality", "build-budgets.json");
const budgets = JSON.parse(fs.readFileSync(budgetsPath, "utf8"));

function filesUnder(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(entryPath) : [entryPath];
  });
}

const report = {};
const failures = [];
for (const [name, budget] of Object.entries(budgets)) {
  const directory = path.join(root, budget.directory);
  if (!fs.existsSync(directory)) {
    failures.push(`${name}: missing build directory ${budget.directory}`);
    continue;
  }
  const files = filesUnder(directory);
  const javascriptFiles = files.filter((file) => /\.[cm]?js$/i.test(file));
  const totalBytes = files.reduce((sum, file) => sum + fs.statSync(file).size, 0);
  const javaScriptBytes = javascriptFiles.reduce((sum, file) => sum + fs.statSync(file).size, 0);
  const largestJavaScriptBytes = javascriptFiles.reduce((largest, file) => Math.max(largest, fs.statSync(file).size), 0);
  report[name] = {
    directory: budget.directory,
    files: files.length,
    totalBytes,
    javaScriptBytes,
    largestJavaScriptBytes,
    budget,
  };
  for (const [metric, maximum] of [
    ["totalBytes", budget.maxTotalBytes],
    ["javaScriptBytes", budget.maxJavaScriptBytes],
    ["largestJavaScriptBytes", budget.maxLargestJavaScriptBytes],
  ]) {
    if (report[name][metric] > maximum) failures.push(`${name}.${metric}: ${report[name][metric]} exceeds ${maximum}`);
  }
}

console.log(JSON.stringify({ success: failures.length === 0, report, failures }, null, 2));
if (failures.length) process.exitCode = 1;
