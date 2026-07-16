#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const { execFileSync } = require("node:child_process");

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
}

const changedFiles = git(["diff", "--cached", "--name-only", "-z"])
  .split("\0")
  .filter(Boolean);
if (changedFiles.length === 0) {
  throw new Error("The coding agent produced no repository change.");
}
if (changedFiles.length > 24) {
  throw new Error(`Repair changes too many files (${changedFiles.length}; maximum 24).`);
}

const allowed = (file) =>
  file.startsWith("src/") ||
  file.startsWith("public/") ||
  file.startsWith("embedded/") ||
  file.startsWith("scripts/") ||
  file === "server.mjs" ||
  file === "server-cluster.mjs";
const forbidden = (file) =>
  file.startsWith(".github/") ||
  file.startsWith(".codex/") ||
  file.startsWith("src/app/api/support/") ||
  file.startsWith("src/app/api/admin/") ||
  file.startsWith("src/app/api/auth/") ||
  file.startsWith("src/app/api/system/") ||
  file.startsWith("src/lib/support-ticket") ||
  file.startsWith("src/lib/auth") ||
  file.startsWith("src/lib/mail-auth") ||
  file === "src/lib/env.ts" ||
  file === "src/lib/stored-user-credentials.ts" ||
  file === "src/lib/system-state-transfer-auth.ts" ||
  file === "src/lib/acumatica-service-auth.ts" ||
  file === "scripts/prepare-ticket-repair-context.cjs" ||
  file === "scripts/validate-ticket-repair.cjs" ||
  file === "scripts/lint-ticket-repair.cjs" ||
  file === "src/proxy.ts" ||
  file === "render.yaml" ||
  file === "Dockerfile" ||
  file === "package.json" ||
  file === "package-lock.json" ||
  file.startsWith("env.") ||
  file.startsWith(".env");

for (const file of changedFiles) {
  if (!allowed(file) || forbidden(file)) {
    throw new Error(`Automated repair may not change ${file}.`);
  }
}

const indexRows = git(["ls-files", "-s", "--", ...changedFiles]).trim().split("\n").filter(Boolean);
if (indexRows.some((row) => row.startsWith("120000 "))) {
  throw new Error("Automated repair may not add or modify symbolic links.");
}

let changedLines = 0;
for (const row of git(["diff", "--cached", "--numstat"]).trim().split("\n").filter(Boolean)) {
  const [added, removed] = row.split("\t");
  if (added === "-" || removed === "-") {
    throw new Error("Automated repair may not introduce binary repository changes.");
  }
  changedLines += Number(added) + Number(removed);
}
if (!Number.isFinite(changedLines) || changedLines > 1600) {
  throw new Error(`Repair diff is too large (${changedLines} changed lines; maximum 1600).`);
}

const addedLines = git(["diff", "--cached", "--unified=0", "--no-color"])
  .split("\n")
  .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
  .join("\n");
const forbiddenAdditions = [
  [/process\.env\b/, "new environment-variable access"],
  [/node:child_process|require\(["']child_process["']\)/, "child-process execution"],
  [/\b(?:exec|execSync|spawn|spawnSync)\s*\(/, "process execution"],
  [/\beval\s*\(|new\s+Function\s*\(/, "dynamic code execution"],
  [/dangerouslySetInnerHTML/, "raw HTML injection"],
  [/x-ticket-repair-secret|TICKET_REPAIR_|api\.github\.com\/repos|api\.render\.com/, "repair-control or deployment access"],
];
for (const [pattern, label] of forbiddenAdditions) {
  if (pattern.test(addedLines)) {
    throw new Error(`Automated repair introduced forbidden ${label}.`);
  }
}

process.stdout.write(`Validated ${changedFiles.length} files and ${changedLines} changed lines.\n`);
