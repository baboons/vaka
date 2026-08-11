#!/usr/bin/env node
/**
 * Updates tvarr in place and restarts it.
 *
 *   node scripts/update.mjs              pull, install, build, restart
 *   node scripts/update.mjs --no-build   skip the web build (watcher-only hosts)
 *   node scripts/update.mjs --force      run every step even if nothing was pulled
 *
 * Reinstalling the unit files rather than a plain restart is deliberate: it
 * keeps the recorded node path correct across Node upgrades, which otherwise
 * leaves the services pointing at a version that no longer exists.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isInstalled, restart } from "./service.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const skipBuild = args.includes("--no-build");
const force = args.includes("--force");

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

function step(message) {
  console.log(`\n  ${message}`);
}

function run(command, commandArgs, { quiet = false } = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: projectRoot,
    stdio: quiet ? "pipe" : "inherit",
    encoding: "utf8",
  });
  return { ok: result.status === 0, output: (result.stdout ?? "").trim() };
}

function git(commandArgs) {
  return run("git", commandArgs, { quiet: true });
}

if (!fs.existsSync(path.join(projectRoot, ".git"))) {
  fail("This is not a git checkout, so there is nothing to pull.");
}

if (!run("sh", ["-c", "command -v git"], { quiet: true }).ok) {
  fail("git was not found on PATH.");
}

// A dirty tree would make the pull fail halfway; better to say so up front.
const dirty = git(["status", "--porcelain", "--untracked-files=no"]).output;
if (dirty && !force) {
  fail(
    "You have uncommitted changes:\n\n" +
      dirty
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n") +
      "\n\n  Commit, stash or discard them first (or pass --force to try anyway).",
  );
}

const before = git(["rev-parse", "HEAD"]).output;

step("Pulling…");
if (!run("git", ["pull", "--ff-only"]).ok) {
  fail(
    "git pull failed. If your branch has diverged, sort that out by hand —\n" +
      "  this script only fast-forwards so it can never lose local commits.",
  );
}

const after = git(["rev-parse", "HEAD"]).output;
const changed = before !== after;

if (!changed && !force) {
  console.log(`
  Already up to date (${after.slice(0, 8)}). Nothing to rebuild.

  To restart the watcher anyway:  pnpm run service:restart
`);
  process.exit(0);
}

if (changed) {
  const range = `${before.slice(0, 8)}..${after.slice(0, 8)}`;
  const log = git(["log", "--oneline", `${before}..${after}`]).output;
  step(`Updated ${range}`);
  if (log) {
    console.log(
      log
        .split("\n")
        .slice(0, 15)
        .map((line) => `    ${line}`)
        .join("\n"),
    );
  }
}

step("Installing dependencies…");
if (!run("pnpm", ["install"]).ok) fail("pnpm install failed.");

if (!skipBuild) {
  step("Building the web interface…");
  if (!run("pnpm", ["build"]).ok) {
    // Deliberately left running: old code serving is better than nothing
    // serving, and the operator can retry once the build is fixed.
    fail("The build failed. tvarr was left running on the old code.");
  }
}

step("Restarting…");
if (isInstalled()) {
  // Rewrites the units with current paths, then restarts both.
  const result = spawnSync(
    process.execPath,
    [path.join(projectRoot, "scripts", "service.mjs"), "install"],
    { cwd: projectRoot, stdio: "inherit" },
  );
  if (result.status !== 0) fail("Could not restart. Check `pnpm run service:status`.");
} else {
  restart({ silent: true });
  console.log(
    "  No service is installed, so nothing was restarted. Install one with\n" +
      "  `pnpm run service:install`, or restart your own processes.",
  );
}

console.log(`
  tvarr is up to date at ${after.slice(0, 8)}.
`);
