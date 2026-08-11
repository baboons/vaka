#!/usr/bin/env node
/**
 * Installs the tvarr watcher as a background service for the current user.
 *
 *   node scripts/install-service.mjs            # install and start
 *   node scripts/install-service.mjs --print    # show the unit file, change nothing
 *   node scripts/install-service.mjs --uninstall
 *
 * Uses a per-user service (launchd LaunchAgent / systemd user unit) rather
 * than a system one: the watcher writes into your home directory and must run
 * as you, not as root.
 */

import { execFileSync } from "node:child_process";
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

const args = process.argv.slice(2);
const printOnly = args.includes("--print");
const uninstall = args.includes("--uninstall");

const nodeBin = process.execPath;
const tsxCli = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
const entry = path.join(projectRoot, "src", "worker", "main.ts");

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!fs.existsSync(tsxCli)) {
  fail("Could not find tsx — run `pnpm install` first.");
}

fs.mkdirSync(dataDir, { recursive: true });

const logFile = path.join(dataDir, "watcher.log");
const errorLogFile = path.join(dataDir, "watcher.error.log");

/* ------------------------------------------------------------------ */
/* macOS — launchd                                                      */
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

function installLaunchd() {
  const target = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);

  if (printOnly) {
    console.log(`\n# ${target}\n`);
    console.log(launchdPlist());
    return;
  }

  if (uninstall) {
    try {
      execFileSync("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`], {
        stdio: "ignore",
      });
    } catch {
      // Not loaded — nothing to unload.
    }
    fs.rmSync(target, { force: true });
    console.log(`\n  Removed the watcher service.\n`);
    return;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, launchdPlist());

  // bootout first so a re-install picks up a changed path.
  try {
    execFileSync("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`], {
      stdio: "ignore",
    });
  } catch {
    // Was not running.
  }
  execFileSync("launchctl", ["bootstrap", `gui/${process.getuid()}`, target], {
    stdio: "inherit",
  });

  console.log(`
  Installed the tvarr watcher as a launchd agent.

    Service   ${LABEL}
    Logs      ${logFile}
    Stop      launchctl bootout gui/${process.getuid()}/${LABEL}
    Remove    node scripts/install-service.mjs --uninstall

  It starts on login and restarts if it exits.
`);
}

/* ------------------------------------------------------------------ */
/* Linux — systemd (user)                                               */
/* ------------------------------------------------------------------ */

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

function installSystemd() {
  const unitDir = path.join(os.homedir(), ".config", "systemd", "user");
  const target = path.join(unitDir, `${SERVICE_NAME}.service`);

  if (printOnly) {
    console.log(`\n# ${target}\n`);
    console.log(systemdUnit());
    return;
  }

  if (uninstall) {
    try {
      execFileSync("systemctl", ["--user", "disable", "--now", SERVICE_NAME], {
        stdio: "ignore",
      });
    } catch {
      // Not installed.
    }
    fs.rmSync(target, { force: true });
    execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
    console.log(`\n  Removed the watcher service.\n`);
    return;
  }

  fs.mkdirSync(unitDir, { recursive: true });
  fs.writeFileSync(target, systemdUnit());

  execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
  execFileSync("systemctl", ["--user", "enable", "--now", SERVICE_NAME], { stdio: "inherit" });

  console.log(`
  Installed the tvarr watcher as a systemd user service.

    Service   ${SERVICE_NAME}
    Status    systemctl --user status ${SERVICE_NAME}
    Logs      journalctl --user -u ${SERVICE_NAME} -f
    Remove    node scripts/install-service.mjs --uninstall

  To keep it running when you are not logged in:
    sudo loginctl enable-linger ${os.userInfo().username}
`);
}

if (process.platform === "darwin") installLaunchd();
else if (process.platform === "linux") installSystemd();
else fail(`Unsupported platform "${process.platform}". Run the watcher with \`pnpm watch\`.`);
