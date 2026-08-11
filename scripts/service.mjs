#!/usr/bin/env node
/**
 * Manages tvarr as a background service.
 *
 *   node scripts/service.mjs install     write the unit files and (re)start
 *   node scripts/service.mjs restart     restart both processes
 *   node scripts/service.mjs start|stop
 *   node scripts/service.mjs status      service state plus the watcher heartbeat
 *   node scripts/service.mjs logs        follow both logs
 *   node scripts/service.mjs print       show the unit files, change nothing
 *   node scripts/service.mjs uninstall
 *
 * Two units are installed, not one: the watcher and the web interface fail for
 * different reasons and are supervised independently, so a crashed UI never
 * stops downloads and restarting one does not disturb the other.
 *
 * Per-user services (systemd user units on Linux, launchd LaunchAgents on
 * macOS) rather than system ones: tvarr writes into your home directory and
 * must run as you, not as root.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The port and data directory are baked into the unit at install time.
 *
 * They are also read back out of an installed unit below, so that re-running
 * install (which `pnpm run update` does on every update) preserves them
 * instead of silently resetting a custom port or database location.
 */
let dataDir = process.env.TVARR_DATA_DIR
  ? path.resolve(process.env.TVARR_DATA_DIR)
  : path.join(os.homedir(), ".tvarr");

let port = process.env.PORT?.trim() || "4000";

const nodeBin = process.execPath;
const tsxCli = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
const watcherEntry = path.join(projectRoot, "src", "worker", "main.ts");
const nextCli = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");

const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";

const SERVICES = [
  {
    key: "watcher",
    unit: "tvarr-watcher",
    label: "dev.tvarr.watcher",
    title: "Watcher",
    description: "tvarr release watcher",
    exec: () => [nodeBin, tsxCli, watcherEntry],
    env: () => ({ NO_COLOR: "1", TVARR_DATA_DIR: dataDir }),
  },
  {
    key: "web",
    unit: "tvarr-web",
    label: "dev.tvarr.web",
    title: "Web interface",
    description: "tvarr web interface",
    exec: () => [nodeBin, nextCli, "start"],
    env: () => ({
      NO_COLOR: "1",
      TVARR_DATA_DIR: dataDir,
      PORT: port,
      NODE_ENV: "production",
    }),
  },
];

function servicePath(service) {
  return isMac
    ? path.join(os.homedir(), "Library", "LaunchAgents", `${service.label}.plist`)
    : path.join(os.homedir(), ".config", "systemd", "user", `${service.unit}.service`);
}

function logPath(service) {
  return path.join(dataDir, `${service.key}.log`);
}

function errorLogPath(service) {
  return path.join(dataDir, `${service.key}.error.log`);
}

/** Environment baked into an installed unit file, if there is one. */
function readUnitEnv(service) {
  const file = servicePath(service);
  if (!fs.existsSync(file)) return {};

  const text = fs.readFileSync(file, "utf8");
  const env = {};

  // Only shouty keys are environment variables; every plist structure key
  // (Label, ProgramArguments, …) contains lowercase letters.
  const pattern = isMac
    ? /<key>([A-Z_]+)<\/key>\s*<string>([^<]*)<\/string>/g
    : /^Environment=([A-Z_]+)=(.*)$/gm;

  for (const match of text.matchAll(pattern)) env[match[1]] = match[2].trim();
  return env;
}

/**
 * Keep the settings an existing install chose, unless this run overrides them
 * explicitly. Without this, `pnpm run update` would reset a custom port or
 * data directory back to the defaults on every update.
 */
function adoptInstalledSettings() {
  const explicitPort = Boolean(process.env.PORT?.trim());
  const explicitDataDir = Boolean(process.env.TVARR_DATA_DIR?.trim());
  if (explicitPort && explicitDataDir) return;

  const installed = { ...readUnitEnv(SERVICES[0]), ...readUnitEnv(SERVICES[1]) };
  if (!explicitPort && installed.PORT) port = installed.PORT;
  if (!explicitDataDir && installed.TVARR_DATA_DIR) dataDir = installed.TVARR_DATA_DIR;
}

adoptInstalledSettings();

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

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
    fail(`Unsupported platform "${process.platform}". Run \`pnpm watch\` and \`pnpm start\`.`);
  }
  if (isLinux && !capture("sh", ["-c", "command -v systemctl"])) {
    fail(
      "systemctl was not found. Without systemd, supervise these two commands\n" +
        "  yourself:\n\n" +
        SERVICES.map((s) => `    ${s.exec().join(" ")}`).join("\n"),
    );
  }
}

export function isInstalled() {
  return SERVICES.some((service) => fs.existsSync(servicePath(service)));
}

/* ------------------------------------------------------------------ */
/* Unit files                                                           */
/* ------------------------------------------------------------------ */

function launchdPlist(service) {
  const env = service.env();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${service.label}</string>
  <key>ProgramArguments</key>
  <array>
${service
  .exec()
  .map((argument) => `    <string>${argument}</string>`)
  .join("\n")}
  </array>
  <key>WorkingDirectory</key>
  <string>${projectRoot}</string>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(env)
  .map(([key, value]) => `    <key>${key}</key>\n    <string>${value}</string>`)
  .join("\n")}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath(service)}</string>
  <key>StandardErrorPath</key>
  <string>${errorLogPath(service)}</string>
</dict>
</plist>
`;
}

function systemdUnit(service) {
  const env = service.env();
  return `[Unit]
Description=${service.description}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${projectRoot}
${Object.entries(env)
  .map(([key, value]) => `Environment=${key}=${value}`)
  .join("\n")}
ExecStart=${service.exec().join(" ")}
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`;
}

function unitContents(service) {
  return isMac ? launchdPlist(service) : systemdUnit(service);
}

/* ------------------------------------------------------------------ */
/* Commands                                                             */
/* ------------------------------------------------------------------ */

function installOne(service) {
  const target = servicePath(service);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, unitContents(service));

  if (isMac) {
    // Rewriting the plist is not enough; the old job must be torn down for
    // changed paths or a changed port to take effect.
    run("launchctl", ["bootout", `gui/${process.getuid()}/${service.label}`], { quiet: true });
    return run("launchctl", ["bootstrap", `gui/${process.getuid()}`, target]);
  }

  run("systemctl", ["--user", "enable", service.unit], { quiet: true });
  // restart rather than start, so re-running install picks up new code.
  return run("systemctl", ["--user", "restart", service.unit]);
}

function install() {
  requireSupportedPlatform();
  if (!fs.existsSync(tsxCli)) fail("Could not find tsx — run `pnpm install` first.");
  if (!fs.existsSync(nextCli)) fail("Could not find next — run `pnpm install` first.");

  const built = fs.existsSync(path.join(projectRoot, ".next", "BUILD_ID"));
  if (!built) {
    fail("No production build found. Run `pnpm build` first, then install the service.");
  }

  fs.mkdirSync(dataDir, { recursive: true });
  if (isLinux) {
    fs.mkdirSync(path.join(os.homedir(), ".config", "systemd", "user"), { recursive: true });
    // Units must exist on disk before daemon-reload sees them.
    for (const service of SERVICES) {
      fs.writeFileSync(servicePath(service), unitContents(service));
    }
    run("systemctl", ["--user", "daemon-reload"]);
  }

  const failed = SERVICES.filter((service) => !installOne(service));
  if (failed.length) {
    fail(
      `Could not start: ${failed.map((s) => s.unit).join(", ")}.\n` +
        `  Check \`pnpm run service:logs\` for the reason.`,
    );
  }

  console.log(`
  tvarr is installed and running.

    Web interface   http://localhost:${port}
    Watcher         downloading in the background
    Units           ${SERVICES.map((s) => path.basename(servicePath(s))).join("  ")}
    Logs            pnpm run service:logs
    Status          pnpm run service:status
    Restart         pnpm run service:restart
    Remove          pnpm run service:uninstall

  Both start at login and restart if they exit.${
    isLinux
      ? `\n\n  To keep them running while you are logged out:\n    sudo loginctl enable-linger ${os.userInfo().username}`
      : ""
  }
`);
}

function uninstall() {
  requireSupportedPlatform();

  for (const service of SERVICES) {
    if (isMac) {
      run("launchctl", ["bootout", `gui/${process.getuid()}/${service.label}`], { quiet: true });
    } else {
      run("systemctl", ["--user", "disable", "--now", service.unit], { quiet: true });
    }
    fs.rmSync(servicePath(service), { force: true });
  }

  if (isLinux) run("systemctl", ["--user", "daemon-reload"], { quiet: true });
  console.log("\n  Removed the tvarr services.\n");
}

function start() {
  requireSupportedPlatform();
  if (!isInstalled()) fail("Not installed. Run `pnpm run service:install` first.");

  for (const service of SERVICES) {
    if (isMac) run("launchctl", ["bootstrap", `gui/${process.getuid()}`, servicePath(service)]);
    else run("systemctl", ["--user", "start", service.unit]);
  }
  console.log("\n  tvarr started.\n");
}

function stop() {
  requireSupportedPlatform();

  for (const service of SERVICES) {
    if (isMac) run("launchctl", ["bootout", `gui/${process.getuid()}/${service.label}`], { quiet: true });
    else run("systemctl", ["--user", "stop", service.unit], { quiet: true });
  }
  console.log("\n  tvarr stopped.\n");
}

export function restart({ silent = false } = {}) {
  requireSupportedPlatform();

  if (!isInstalled()) {
    if (!silent) {
      console.log(
        "\n  No service is installed, so there is nothing to restart.\n" +
          "  Install one with `pnpm run service:install`.\n",
      );
    }
    return false;
  }

  let ok = true;
  for (const service of SERVICES) {
    const restarted = isMac
      ? // kickstart -k restarts a running job and starts a stopped one.
        run("launchctl", ["kickstart", "-k", `gui/${process.getuid()}/${service.label}`])
      : run("systemctl", ["--user", "restart", service.unit]);
    if (!restarted) ok = false;
  }

  if (!silent) console.log(ok ? "\n  tvarr restarted.\n" : "\n  Could not restart every service.\n");
  return ok;
}

/** Reads the heartbeat the watcher writes into the database. */
function readHeartbeat() {
  const dbPath = path.join(dataDir, "tvarr.db");
  if (!fs.existsSync(dbPath)) return null;
  try {
    // Loaded lazily: status should still work if deps are mid-install.
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

function serviceState(service) {
  if (!fs.existsSync(servicePath(service))) return "not installed";
  if (isMac) {
    const listed = capture("launchctl", ["list", service.label]);
    const running = listed && /"PID"\s*=\s*(\d+)/.exec(listed);
    return running ? `running (pid ${running[1]})` : "loaded, not running";
  }
  return capture("systemctl", ["--user", "is-active", service.unit]) ?? "inactive";
}

function status() {
  requireSupportedPlatform();

  console.log(`\n  Data dir    ${dataDir}`);
  console.log(`  Web         http://localhost:${port}\n`);

  for (const service of SERVICES) {
    console.log(`  ${service.title.padEnd(14)}${serviceState(service)}`);
  }

  const worker = readHeartbeat();
  if (!worker || !worker.heartbeatAt) {
    // The watcher clears its heartbeat on a clean exit, so a previous
    // startedAt means it ran and stopped rather than never having run.
    console.log(
      worker?.startedAt
        ? `  Heartbeat     stopped cleanly (last ran ${ago(worker.lastPollAt)})\n`
        : "  Heartbeat     the watcher has never run against this database\n",
    );
    return;
  }

  const stale = Date.now() - new Date(worker.heartbeatAt).getTime() > 90_000;
  console.log(
    `  Heartbeat     ${ago(worker.heartbeatAt)}${stale ? "  (stale — the watcher looks stuck)" : ""}`,
  );
  console.log(`  Last check    ${ago(worker.lastPollAt)}`);
  if (worker.lastError) console.log(`  Last error    ${worker.lastError}`);
  console.log("");
}

function logs() {
  requireSupportedPlatform();

  if (isMac) {
    const files = SERVICES.flatMap((service) => [logPath(service), errorLogPath(service)]).filter(
      (file) => fs.existsSync(file),
    );
    if (!files.length) fail(`No logs yet under ${dataDir}`);
    run("tail", ["-n", "50", "-f", ...files]);
  } else {
    run("journalctl", ["--user", ...SERVICES.flatMap((s) => ["-u", s.unit]), "-n", "100", "-f"]);
  }
}

function print() {
  for (const service of SERVICES) {
    console.log(`\n# ${servicePath(service)}\n`);
    console.log(unitContents(service));
  }
}

const COMMANDS = { install, uninstall, start, stop, restart, status, logs, print };

// Only act when run directly, so update.mjs can import restart()/isInstalled().
if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const command = process.argv[2] ?? "install";
  const handler = COMMANDS[command];
  if (!handler) fail(`Unknown command "${command}". Try: ${Object.keys(COMMANDS).join(", ")}`);
  handler();
}
