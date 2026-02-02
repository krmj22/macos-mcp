/**
 * jxaExecutor.ts
 * Executes JXA (JavaScript for Automation) scripts via osascript for Apple app integration.
 */

import { execFile } from 'node:child_process';

/**
 * Structured error for JXA execution failures
 */
export class JxaError extends Error {
  constructor(
    message: string,
    public readonly app: string,
    public readonly isPermissionError: boolean,
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = 'JxaError';
  }
}

/**
 * Escapes a string for safe interpolation into JXA scripts.
 * Prevents injection by escaping backslashes, quotes, and control characters.
 */
export function sanitizeForJxa(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\0/g, '')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Builds a JXA script by replacing {{paramName}} placeholders with sanitized values.
 */
export function buildScript(
  template: string,
  params: Record<string, string>,
): string {
  let script = template;
  for (const [key, value] of Object.entries(params)) {
    script = script.split(`{{${key}}}`).join(sanitizeForJxa(value));
  }
  return script;
}

/**
 * Known permission error patterns per app
 */
const PERMISSION_PATTERNS: Record<string, RegExp[]> = {
  Notes: [
    /not allowed/i,
    /permission/i,
    /not authorized/i,
    /AppleEvent handler failed/i,
  ],
  Mail: [
    /not allowed/i,
    /permission/i,
    /not authorized/i,
    /AppleEvent handler failed/i,
  ],
  Messages: [
    /not allowed/i,
    /permission/i,
    /not authorized/i,
    /AppleEvent handler failed/i,
    /1002/,
  ],
};

/**
 * Detects whether stderr indicates a permission error for the given app.
 */
export function detectPermissionError(
  stderr: string,
  app: string,
): JxaError | null {
  const patterns = PERMISSION_PATTERNS[app] ?? PERMISSION_PATTERNS.Notes;
  for (const pattern of patterns) {
    if (pattern.test(stderr)) {
      return new JxaError(
        `Permission denied for ${app}. Grant access in System Settings > Privacy & Security > Automation.`,
        app,
        true,
        stderr,
      );
    }
  }
  return null;
}

/**
 * Executes an AppleScript via osascript (without -l JavaScript flag).
 * @param script - The AppleScript string to execute
 * @param timeoutMs - Execution timeout in milliseconds (default 10000)
 * @param app - The target app name for error detection
 * @returns Raw stdout string
 */
export function executeAppleScript(
  script: string,
  timeoutMs = 10000,
  app = 'Unknown',
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      '/usr/bin/osascript',
      ['-e', script],
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const permError = detectPermissionError(stderr || error.message, app);
          if (permError) {
            reject(permError);
            return;
          }
          reject(
            new JxaError(
              `AppleScript execution failed for ${app}: ${error.message}`,
              app,
              false,
              stderr,
            ),
          );
          return;
        }
        resolve(stdout.trim());
      },
    );

    child.on('error', (err) => {
      reject(
        new JxaError(`Failed to start osascript: ${err.message}`, app, false),
      );
    });
  });
}

/**
 * Executes a JXA script via osascript and returns parsed JSON output.
 * @param script - The JXA script string to execute
 * @param timeoutMs - Execution timeout in milliseconds (default 10000)
 * @param app - The target app name for error detection
 * @returns Parsed JSON result from the script
 */
/**
 * Transient error patterns that are worth retrying
 */
const TRANSIENT_PATTERNS: RegExp[] = [
  /timed?\s*out/i,
  /connection invalid/i,
  /connection is invalid/i,
  /EPIPE/i,
  /osascript.*not respond/i,
];

function isTransientError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const stderr = error instanceof JxaError ? (error.stderr ?? '') : '';
  const combined = `${message} ${stderr}`;
  return TRANSIENT_PATTERNS.some((p) => p.test(combined));
}

/**
 * Executes a JXA script with retry logic for transient failures.
 * Retries up to `maxRetries` times with `delayMs` between attempts.
 * Skips retry for permission errors (no point retrying).
 * @param script - The JXA script string to execute
 * @param timeoutMs - Execution timeout in milliseconds (default 10000)
 * @param app - The target app name for error detection
 * @param maxRetries - Maximum retry attempts (default 2)
 * @param delayMs - Delay between retries in milliseconds (default 1000)
 * @returns Parsed JSON result from the script
 */
export async function executeJxaWithRetry<T>(
  script: string,
  timeoutMs = 10000,
  app = 'Unknown',
  maxRetries = 2,
  delayMs = 1000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await executeJxa<T>(script, timeoutMs, app);
    } catch (error) {
      lastError = error;
      // Never retry permission errors
      if (error instanceof JxaError && error.isPermissionError) {
        throw error;
      }
      // Only retry transient errors
      if (!isTransientError(error) || attempt === maxRetries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

export function executeJxa<T>(
  script: string,
  timeoutMs = 10000,
  app = 'Unknown',
): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', '-e', script],
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const permError = detectPermissionError(stderr || error.message, app);
          if (permError) {
            reject(permError);
            return;
          }
          reject(
            new JxaError(
              `JXA execution failed for ${app}: ${error.message}`,
              app,
              false,
              stderr,
            ),
          );
          return;
        }

        const trimmed = stdout.trim();
        if (!trimmed) {
          resolve(undefined as T);
          return;
        }

        try {
          resolve(JSON.parse(trimmed) as T);
        } catch {
          // If output isn't JSON, return as string
          resolve(trimmed as T);
        }
      },
    );

    // Safety: kill on timeout (execFile timeout sends SIGTERM but we ensure cleanup)
    child.on('error', (err) => {
      reject(
        new JxaError(`Failed to start osascript: ${err.message}`, app, false),
      );
    });
  });
}
