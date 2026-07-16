#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const { execFileSync, spawnSync } = require("node:child_process");

const lintablePattern = /\.(?:cjs|mjs|js|jsx|ts|tsx)$/i;
const files = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter((file) => file && lintablePattern.test(file));

if (files.length === 0) {
  process.stdout.write("No changed lintable files.\n");
  process.exit(0);
}

const result = spawnSync("npx", ["eslint", "--max-warnings", "0", ...files], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
