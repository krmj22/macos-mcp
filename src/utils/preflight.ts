/**
 * preflight.ts
 * Startup validation checks for the macos-mcp server.
 * Run with `node dist/index.js --check` to verify the environment.
 */

import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { homedir, platform, release } from 'node:os';
import { join } from 'node:path';
import { FILE_SYSTEM } from './constants.js';
import { findProjectRoot } from './projectUtils.js';

export interface CheckResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  message: string;
}

function execPromise(
  cmd: string,
  args: string[],
  timeoutMs = 5000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

/** Check that we're running on macOS. */
export function checkPlatform(): CheckResult {
  const p = platform();
  if (p !== 'darwin') {
    return {
      name: 'macOS platform',
      status: 'FAIL',
      message: `Expected macOS (darwin), got ${p}`,
    };
  }

  const ver = release();
  // Darwin 23.x = macOS 14 (Sonoma), 24.x = macOS 15 (Sequoia)
  const major = Number.parseInt(ver.split('.')[0], 10);
  if (major < 23) {
    return {
      name: 'macOS platform',
      status: 'WARN',
      message: `Darwin ${ver} (pre-Sonoma). Some features may not work correctly.`,
    };
  }

  return {
    name: 'macOS platform',
    status: 'PASS',
    message: `Darwin ${ver}`,
  };
}

/** Check Node.js version >= 18. */
export function checkNodeVersion(): CheckResult {
  const version = process.versions.node;
  const major = Number.parseInt(version.split('.')[0], 10);
  if (major < 18) {
    return {
      name: 'Node.js version',
      status: 'FAIL',
      message: `Node.js ${version} — requires >= 18`,
    };
  }
  return {
    name: 'Node.js version',
    status: 'PASS',
    message: `Node.js ${version}`,
  };
}

/** Check that the Swift EventKit binary exists and is executable. */
export function checkSwiftBinary(): CheckResult {
  try {
    const projectRoot = findProjectRoot();
    const binaryPath = join(projectRoot, 'bin', FILE_SYSTEM.SWIFT_BINARY_NAME);
    accessSync(binaryPath, constants.X_OK);
    return {
      name: 'EventKit binary',
      status: 'PASS',
      message: binaryPath,
    };
  } catch {
    return {
      name: 'EventKit binary',
      status: 'FAIL',
      message: `${FILE_SYSTEM.SWIFT_BINARY_NAME} not found or not executable. Run: pnpm build`,
    };
  }
}

/** Check Full Disk Access for Messages database. */
export function checkMessagesFda(): CheckResult {
  const dbPath = join(homedir(), 'Library', 'Messages', 'chat.db');
  try {
    accessSync(dbPath, constants.R_OK);
    return {
      name: 'Messages database (FDA)',
      status: 'PASS',
      message: dbPath,
    };
  } catch {
    return {
      name: 'Messages database (FDA)',
      status: 'WARN',
      message:
        'Cannot read ~/Library/Messages/chat.db. Grant Full Disk Access to your terminal or node binary.',
    };
  }
}

/** Check Full Disk Access for Mail database. */
export function checkMailFda(): CheckResult {
  const dbPath = join(
    homedir(),
    'Library',
    'Mail',
    'V10',
    'MailData',
    'Envelope Index',
  );
  try {
    accessSync(dbPath, constants.R_OK);
    return {
      name: 'Mail database (FDA)',
      status: 'PASS',
      message: dbPath,
    };
  } catch {
    return {
      name: 'Mail database (FDA)',
      status: 'WARN',
      message:
        'Cannot read Mail database. Grant Full Disk Access to your terminal or node binary.',
    };
  }
}

/** Probe a JXA app with a minimal script. */
export async function checkJxaApp(app: string): Promise<CheckResult> {
  try {
    await execPromise('/usr/bin/osascript', [
      '-l',
      'JavaScript',
      '-e',
      `Application("${app}").name()`,
    ]);
    return {
      name: `${app} (JXA)`,
      status: 'PASS',
      message: `${app} accessible`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/not authorized/i.test(msg) || /permission/i.test(msg)) {
      return {
        name: `${app} (JXA)`,
        status: 'WARN',
        message: `${app} automation permission not granted. Open: System Settings > Privacy & Security > Automation`,
      };
    }
    return {
      name: `${app} (JXA)`,
      status: 'WARN',
      message: `${app}: ${msg}`,
    };
  }
}

/**
 * Runs all preflight checks and returns results.
 */
export async function runPreflight(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Synchronous checks
  results.push(checkPlatform());
  results.push(checkNodeVersion());
  results.push(checkSwiftBinary());
  results.push(checkMessagesFda());
  results.push(checkMailFda());

  // Async JXA probes
  const jxaApps = ['Notes', 'Mail', 'Contacts'];
  for (const app of jxaApps) {
    results.push(await checkJxaApp(app));
  }

  return results;
}

/**
 * Formats check results for console output.
 */
export function formatResults(results: CheckResult[]): string {
  const lines = results.map((r) => {
    const icon =
      r.status === 'PASS' ? 'PASS' : r.status === 'WARN' ? 'WARN' : 'FAIL';
    return `  [${icon}] ${r.name}: ${r.message}`;
  });

  const hasFailure = results.some((r) => r.status === 'FAIL');
  const warnCount = results.filter((r) => r.status === 'WARN').length;

  lines.unshift('macos-mcp preflight checks:');
  lines.push('');

  if (hasFailure) {
    lines.push(
      'Result: FAIL — fix the issues above before starting the server.',
    );
  } else if (warnCount > 0) {
    lines.push(
      `Result: OK with ${warnCount} warning(s) — some features may not work.`,
    );
  } else {
    lines.push('Result: All checks passed.');
  }

  return lines.join('\n');
}
