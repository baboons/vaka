#!/usr/bin/env node
/**
 * Manages the tvarr watcher as a background service.
 *
 *   node scripts/service.mjs install     write the unit file and (re)start
 *   node scripts/service.mjs restart     restart the running watcher
 *   node scripts/service.mjs start|stop
 *   node scripts/service.mjs status      service state plus the watcher heartbeat
 *   node scripts/service.mjs logs        follow the log
 *   node scripts/service.mjs print       show the unit file, change nothing
 *   node scripts/service.mjs uninstall
 *
 * Uses a per-user service (systemd user unit on Linux, launchd LaunchAgent on
 * macOS) rather than a system one: the watcher writes into your home directory
 * and must run as you, not as root.
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.TVARR_DATA_DIR
  ? path.resolve(process.env.TVARR_DATA_DIR)
  : path.join(os.homedir(), ".tvarr");

const LABEL = "dev.tvarr.watcher";
const SERVICE_NAME = "tvarr-watcher";

const nodeBin = process.execPath;
const tsxCli = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
const entry = path.join(projectRoot, "src", "worker", "main.ts");

const logFile = path.join(dataDir, "watcher.log");
const errorLogFile = path.join(dataDir, "watcher.error.log");

const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";

const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const unitPath = path.join(
  os.homedir(),
  ".config",
  "systemd",
  "user",
  `${SERVICE_NAME}.service`,
);
const servicePath = isMac ? plistPath : unitPath;

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

function info(message) {
  console.log(message);
}

/** Run a command, inheriting stdio. Returns true when it exited cleanly. */
function run(command, args, { quiet = false } = {}) {
  const result = spawnSync(command, args, { stdio: quiet ? "ignore" : "inherit" });
  return result.status === 0;
}

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return result.status === 0 ? (result.stdout ?? "").trim() : null;
}

function requireSupportedPlatform() {
  if (!isMac && !isLinux) {
    fail(`Unsupported platform "${process.platform}". Run the watcher with \`pnpm watch\`.`);
  }
  if (isLinux && !capture("sh", ["-c", "command -v systemctl"])) {
    fail(
      "systemctl was not found. Without systemd, run the watcher under your own\n" +
        "  process manager, pointing it at:\n\n" +
        `    ${nodeBin} ${tsxCli} ${entry}`,
    );
  }
}

export function isInstalled() {
  return fs.existsSync(servicePath);
}

/* ------------------------------------------------------------------ */
/* Unit files                                                           */
/* ------------------------------------------------------------------ */

function launchdPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${tsxCli}</string>
    <string>${entry}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${projectRoot}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NO_COLOR</key>
    <string>1</string>
    <key>TVARR_DATA_DIR</key>
    <string>${dataDir}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logFile}</string>
  <key>StandardErrorPath</key>
  <string>${errorLogFile}</string>
</dict>
</plist>
`;
}

function systemdUnit() {
  return `[Unit]
Description=tvarr release watcher
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${projectRoot}
Environment=NO_COLOR=1
Environment=TVARR_DATA_DIR=${dataDir}
ExecStart=${nodeBin} ${tsxCli} ${entry}
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`;
}

function unitContents() {
  return isMac ? launchdPlist() : systemdUnit();
}

/* ------------------------------------------------------------------ */
/* Commands                                                             */
/* ------------------------------------------------------------------ */

function install() {
  requireSupportedPlatform();
  if (!fs.existsSync(tsxCli)) fail("Could not find tsx — run `pnpm install` first.");

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.dirname(servicePath), { recursive: true });
  fs.writeFileSync(servicePath, unitContents());

  if (isMac) {
    // Rewriting the plist is not enough; the old job has to be torn down so
    // the new paths take effect.
    run("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`], { quiet: true });
    if (!run("launchctl", ["bootstrap", `gui/${process.getuid()}`, servicePath])) {
      fail("launchctl could not start the service. Check the log at " + logFile);
    }
  } else {
    run("systemctl", ["--user", "daemon-reload"]);
    run("systemctl", ["--user", "enable", SERVICE_NAME], { quiet: true });
    // restart rather than start, so re-running this picks up new code.
    if (!run("systemctl", ["--user", "restart", SERVICE_NAME])) {
      fail(`systemctl could not start the service. Try: journalctl --user -u ${SERVICE_NAME} -n 50`);
    }
  }

  info(`
  The tvarr watcher is installed and running.

    Unit      ${servicePath}
    Logs      ${isMac ? logFile : `journalctl --user -u ${SERVICE_NAME} -f`}
    Restart   pnpm run service:restart
    Status    pnpm run service:status
    Remove    pnpm run service:uninstall

  It starts at login and restarts if it exits.${
    isLinux
      ? `\n\n  To keep it running while you are logged out:\n    sudo loginctl enable-linger ${os.userInfo().username}`
      : ""
  }
`);
}

function uninstall() {
  requireSupportedPlatform();

  if (isMac) {
    run("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`], { quiet: true });
  } else {
    run("systemctl", ["--user", "disable", "--now", SERVICE_NAME], { quiet: true });
  }

  fs.rmSync(servicePath, { force: true });
  if (isLinux) run("systemctl", ["--user", "daemon-reload"], { quiet: true });

  info("\n  Removed the tvarr watcher service.\n");
}

function start() {
  requireSupportedPlatform();
  if (!isInstalled()) fail("Not installed. Run `pnpm run service:install` first.");

  const ok = isMac
    ? run("launchctl", ["bootstrap", `gui/${process.getuid()}`, servicePath])
    : run("systemctl", ["--user", "start", SERVICE_NAME]);

  info(ok ? "\n  Watcher started.\n" : "\n  Could not start the watcher.\n");
}

function stop() {
  requireSupportedPlatform();

  const ok = isMac
    ? run("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`])
    : run("systemctl", ["--user", "stop", SERVICE_NAME]);

  info(ok ? "\n  Watcher stopped.\n" : "\n  The watcher was not running.\n");
}

export function restart({ silent = false } = {}) {
  requireSupportedPlatform();

  if (!isInstalled()) {
    if (!silent) {
      info(
        "\n  No service is installed, so there is nothing to restart.\n" +
          "  Install one with `pnpm run service:install`, or run `pnpm watch` yourself.\n",
      );
    }
    return false;
  }

  const ok = isMac
    ? // kickstart -k restarts a running job, and starts it if it is stopped.
      run("launchctl", ["kickstart", "-k", `gui/${process.getuid()}/${LABEL}`])
    : run("systemctl", ["--user", "restart", SERVICE_NAME]);

  if (!silent) info(ok ? "\n  Watcher restarted.\n" : "\n  Could not restart the watcher.\n");
  return ok;
}

/** Reads the heartbeat the watcher writes into the database. */
function readHeartbeat() {
  const dbPath = path.join(dataDir, "tvarr.db");
  if (!fs.existsSync(dbPath)) return null;
  try {
    // Imported lazily: status should still work if deps are mid-install.
    const require = createRequire(import.meta.url);
    const Database = require("better-sqlite3");
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const row = db.prepare("SELECT value FROM settings WHERE key = 'worker'").get();
    db.close();
    return row ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
}

function ago(iso) {
  if (!iso) return "—";
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function status() {
  requireSupportedPlatform();

  info(`\n  Unit file   ${isInstalled() ? servicePath : "not installed"}`);
  info(`  Data dir    ${dataDir}\n`);

  if (isInstalled()) {
    if (isMac) {
      const listed = capture("launchctl", ["list", LABEL]);
      const running = listed && /"PID"\s*=\s*(\d+)/.exec(listed);
      info(`  launchd     ${running ? `running (pid ${running[1]})` : "loaded, not running"}`);
    } else {
      const state = capture("systemctl", ["--user", "is-active", SERVICE_NAME]) ?? "inactive";
      info(`  systemd     ${state}`);
    }
  }

  const worker = readHeartbeat();
  if (!worker || !worker.heartbeatAt) {
    info("  Heartbeat   none recorded yet\n");
    return;
  }

  const stale = Date.now() - new Date(worker.heartbeatAt).getTime() > 90_000;
  info(`  Heartbeat   ${ago(worker.heartbeatAt)}${stale ? "  (stale — the watcher looks stopped)" : ""}`);
  info(`  Last check  ${ago(worker.lastPollAt)}`);
  if (worker.lastError) info(`  Last error  ${worker.lastError}`);
  info("");
}

function logs() {
  requireSupportedPlatform();

  if (isMac) {
    if (!fs.existsSync(logFile)) fail(`No log yet at ${logFile}`);
    run("tail", ["-n", "100", "-f", logFile]);
  } else {
    run("journalctl", ["--user", "-u", SERVICE_NAME, "-n", "100", "-f"]);
  }
}

function print() {
  console.log(`\n# ${servicePath}\n`);
  console.log(unitContents());
}

import { createRequire } from "node:module";

const COMMANDS = { install, uninstall, start, stop, restart, status, logs, print };

// Only act when run directly, so update.mjs can import restart()/isInstalled().
if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const command = process.argv[2] ?? "install";
  const handler = COMMANDS[command];
  if (!handler) {
    fail(`Unknown command "${command}". Try: ${Object.keys(COMMANDS).join(", ")}`);
  }
  handler();
}
