// owner: @evgenyadev · why: the hook is a gate; a gate without its own test silently rots (false blocks or no blocks) · review-by: 2027-02-20
// Run: npm run hook:test

import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const root = join(import.meta.dirname, "..", "..");
const hook = join(import.meta.dirname, "protect-migrations.mjs");
const logFile = join(import.meta.dirname, "test-run.log");

function run(tool_name, tool_input) {
  const r = spawnSync("node", [hook], {
    input: JSON.stringify({ tool_name, tool_input, cwd: root }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, PROTECT_MIGRATIONS_LOG: logFile },
    encoding: "utf8",
  });
  return { code: r.status, stderr: r.stderr };
}

const applied = "db/migrations/001_create_tasks.sql";

test.after(() => rmSync(logFile, { force: true }));

test("blocks Edit of an applied migration, relative path", () => {
  const r = run("Edit", { file_path: applied });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /applied migration/);
});

test("blocks Write of an applied migration, absolute path", () => {
  assert.equal(run("Write", { file_path: join(root, "db/migrations/002_add_task_estimate.sql") }).code, 2);
});

test("blocks a case variant of an applied migration (case-insensitive file systems)", () => {
  assert.equal(run("Edit", { file_path: "DB/Migrations/001_CREATE_TASKS.sql" }).code, 2);
});

test("blocks a path that reaches the migration through ..", () => {
  assert.equal(run("Edit", { file_path: "app/../db/migrations/001_create_tasks.sql" }).code, 2);
});

test("blocks a BOM-prefixed payload (Windows PowerShell pipe)", () => {
  const payload = JSON.stringify({ tool_name: "Edit", tool_input: { file_path: applied }, cwd: root });
  const r = spawnSync("node", [hook], {
    input: "﻿" + payload,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, PROTECT_MIGRATIONS_LOG: logFile },
  });
  assert.equal(r.status, 2);
});

test("allows a new migration file", () => {
  assert.equal(run("Write", { file_path: "db/migrations/003_add_priority.sql" }).code, 0);
});

test("allows files outside db/migrations", () => {
  assert.equal(run("Edit", { file_path: "lib/tasks.ts" }).code, 0);
});

for (const command of [
  `sed -i '' s/120/200/ ${applied}`,
  `echo x >> ${applied}`,
  `npm test && rm ${applied}`,
  `mv ${applied} /tmp/x.sql`,
  `echo x > ${applied.toUpperCase()}`,
]) {
  test(`blocks Bash: ${command}`, () => assert.equal(run("Bash", { command }).code, 2));
}

for (const command of [`cat ${applied}`, `grep check ${applied} > out.txt; rm -f out.txt`, "ls db/migrations"]) {
  test(`allows Bash: ${command}`, () => assert.equal(run("Bash", { command }).code, 0));
}

test("fails open on a malformed payload", () => {
  const r = spawnSync("node", [hook], { input: "not json", env: { ...process.env, PROTECT_MIGRATIONS_LOG: logFile } });
  assert.equal(r.status, 0);
});
