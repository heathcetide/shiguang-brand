import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const contractName = process.argv[2] || "inventory";
if (!["inventory", "community"].includes(contractName)) throw new Error("Unknown contract");
const contractPath = `packages/contracts/openapi/${contractName}.v1.json`;
const current = JSON.parse(readFileSync(resolve(repositoryRoot, contractPath), "utf8"));
const baseName = process.env.CONTRACT_BASE_REF || process.env.GITHUB_BASE_REF || "main";
const candidates = [`origin/${baseName}`, baseName];
let baseline = null;

for (const candidate of candidates) {
  try {
    baseline = JSON.parse(execFileSync("git", ["show", `${candidate}:${contractPath}`], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }));
    break;
  } catch {
    // The first committed contract establishes the compatibility baseline.
  }
}

if (!baseline) {
  console.log(`No ${contractName} OpenAPI baseline exists yet; this artifact establishes the baseline.`);
  process.exit(0);
}

const breaking = [];
const methods = ["get", "post", "put", "patch", "delete"];
for (const [path, oldPath] of Object.entries(baseline.paths || {})) {
  const nextPath = current.paths?.[path];
  if (!nextPath) {
    breaking.push(`removed path ${path}`);
    continue;
  }
  for (const method of methods) {
    const oldOperation = oldPath[method];
    const nextOperation = nextPath[method];
    if (oldOperation && !nextOperation) {
      breaking.push(`removed operation ${method.toUpperCase()} ${path}`);
      continue;
    }
    if (!oldOperation || !nextOperation) continue;
    for (const status of Object.keys(oldOperation.responses || {})) {
      if (!nextOperation.responses?.[status]) breaking.push(`removed response ${status} from ${method.toUpperCase()} ${path}`);
    }
  }
}

function compareSchema(name, oldSchema, nextSchema, location = name) {
  if (!nextSchema) {
    breaking.push(`removed schema ${location}`);
    return;
  }
  if (oldSchema.type && nextSchema.type && JSON.stringify(oldSchema.type) !== JSON.stringify(nextSchema.type)) {
    breaking.push(`changed type at ${location}`);
  }
  if (oldSchema.$ref && oldSchema.$ref !== nextSchema.$ref) {
    breaking.push(`changed schema reference at ${location}`);
  }
  if (Array.isArray(oldSchema.enum)) {
    const nextValues = new Set(nextSchema.enum || []);
    for (const value of oldSchema.enum) if (!nextValues.has(value)) breaking.push(`removed enum value ${JSON.stringify(value)} at ${location}`);
  }
  const oldRequired = new Set(oldSchema.required || []);
  const nextRequired = new Set(nextSchema.required || []);
  if (name.endsWith("Request")) {
    for (const key of nextRequired) if (!oldRequired.has(key)) breaking.push(`added required request field at ${location}.${key}`);
  } else {
    for (const key of oldRequired) if (!nextRequired.has(key)) breaking.push(`made response field optional at ${location}.${key}`);
  }
  for (const [key, child] of Object.entries(oldSchema.properties || {})) {
    if (!nextSchema.properties?.[key]) breaking.push(`removed field ${location}.${key}`);
    else compareSchema(name, child, nextSchema.properties[key], `${location}.${key}`);
  }
  if (oldSchema.items) compareSchema(name, oldSchema.items, nextSchema.items, `${location}[]`);
}

for (const [name, schema] of Object.entries(baseline.components?.schemas || {})) {
  compareSchema(name, schema, current.components?.schemas?.[name]);
}

if (breaking.length) {
  console.error(`Breaking ${contractName} API changes detected:\n- ${breaking.join("\n- ")}`);
  process.exit(1);
}
console.log(`${contractName} OpenAPI is backward compatible with the base branch.`);
