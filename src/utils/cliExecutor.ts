/**
 * @fileoverview Swift CLI execution and JSON response parsing
 * @module utils/cliExecutor
 * @description Executes the EventKitCLI binary for native macOS EventKit operations
 */

import type { ExecFileException } from 'node:child_process';
import { execFile } from 'node:child_process';
import path from 'node:path';
import {
  findSecureBinaryPath,
  getEnvironmentBinaryConfig,
} from './binaryValidator.js';
import { FILE_SYSTEM } from './constants.js';
import {
  hasBeenPrompted,
  type PermissionDomain,
  triggerPermissionPrompt,
} from './permissionPrompt.js';
import { findProjectRoot } from './projectUtils.js';

const execFilePromise = (
  cliPath: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    execFile(cliPath, args, (error, stdout, stderr) => {
      if (error) {
        const execError = error as ExecFileException & {
          stdout?: string | Buffer;
          stderr?: string | Buffer;
        };
        execError.stdout = stdout;
        execError.stderr = stderr;
        reject(execError);
        return;
      }
      resolve({ stdout, stderr });
    });
  });

interface CliSuccessResponse<T> {
  status: 'success';
  result: T;
}

interface CliErrorResponse {
  status: 'error';
  message: string;
}

type CliResponse<T> = CliSuccessResponse<T> | CliErrorResponse;

/**
 * Permission error patterns from the Swift CLI
 */
const PERMISSION_ERROR_PATTERNS: Record<PermissionDomain, RegExp[]> = {
  reminders: [
    /reminder permission denied/i,
    /reminders access denied/i,
    /not authorized.*reminders/i,
  ],
  calendars: [
    /calendar permission denied/i,
    /calendar access denied/i,
    /not authorized.*calendar/i,
  ],
};

/**
 * Calendar-specific action names used in Swift CLI
 */
const CALENDAR_ACTIONS = new Set([
  'read-events',
  'read-calendars',
  'create-event',
  'update-event',
  'delete-event',
]);

/**
 * Detects which permission domain an action requires
 * @param args - CLI arguments array
 * @returns The permission domain ('reminders' or 'calendars')
 */
function detectActionDomain(args: string[]): PermissionDomain {
  const actionIndex = args.indexOf('--action');
  if (actionIndex !== -1 && actionIndex + 1 < args.length) {
    const action = args[actionIndex + 1];
    return CALENDAR_ACTIONS.has(action) ? 'calendars' : 'reminders';
  }
  return 'reminders'; // Default to reminders if action not found
}

/**
 * Detects if an error message indicates a permission issue
 * @param message - Error message to check
 * @returns The permission domain if detected, null otherwise
 */
function detectPermissionError(message: string): PermissionDomain | null {
  for (const [domain, patterns] of Object.entries(PERMISSION_ERROR_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(message))) {
      return domain as PermissionDomain;
    }
  }
  return null;
}

/**
 * Custom error class for permission-related failures
 */
export class CliPermissionError extends Error {
  constructor(
    message: string,
    public readonly domain: PermissionDomain,
  ) {
    super(message);
    this.name = 'CliPermissionError';
  }
}

/**
 * Calendar action strings used in Swift CLI (different from MCP tool action names)
 */

const bufferToString = (data?: string | Buffer | null): string | null => {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return data == null ? null : String(data);
};

/**
 * Parses JSON output from CLI
 */
const parseCliOutput = <T>(output: string): T => {
  let parsed: CliResponse<T>;
  try {
    parsed = JSON.parse(output) as CliResponse<T>;
  } catch (_error) {
    throw new Error('EventKitCLI execution failed: Invalid CLI output');
  }

  if (parsed.status === 'success') {
    return parsed.result;
  }

  // Check for permission errors and throw specialized error
  const permissionDomain = detectPermissionError(parsed.message);
  if (permissionDomain) {
    throw new CliPermissionError(parsed.message, permissionDomain);
  }

  throw new Error(parsed.message);
};

const runCli = async <T>(cliPath: string, args: string[]): Promise<T> => {
  try {
    const { stdout } = await execFilePromise(cliPath, args);
    const normalized = bufferToString(stdout);
    if (!normalized) {
      throw new Error('EventKitCLI execution failed: Empty CLI output');
    }
    return parseCliOutput(normalized);
  } catch (error) {
    // Preserve CliPermissionError for retry logic
    if (error instanceof CliPermissionError) {
      throw error;
    }
    const execError = error as ExecFileException & {
      stdout?: string | Buffer;
    };
    const normalized = bufferToString(execError?.stdout);
    if (normalized) {
      return parseCliOutput(normalized);
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`EventKitCLI execution failed: ${errorMessage}`);
  }
};

/**
 * Executes the EventKitCLI binary for native macOS EventKit operations
 * @template T - Expected return type from the Swift CLI
 * @param {string[]} args - Array of arguments to pass to the CLI
 * @returns {Promise<T>} Parsed JSON result from the CLI
 * @throws {Error} If binary not found, validation fails, or CLI execution fails
 * @description
 * - Locates binary using secure path validation
 * - Parses JSON response from Swift CLI
 * - Proactively triggers permission prompts via AppleScript on first access
 * - Automatically retries with AppleScript fallback on permission errors
 * @example
 * const result = await executeCli<Reminder[]>(['--action', 'read', '--showCompleted', 'true']);
 */
export async function executeCli<T>(args: string[]): Promise<T> {
  const projectRoot = findProjectRoot();
  const binaryName = FILE_SYSTEM.SWIFT_BINARY_NAME;
  const possiblePaths = [path.join(projectRoot, 'bin', binaryName)];

  const config = {
    ...getEnvironmentBinaryConfig(),
    allowedPaths: [
      '/bin/',
      '/dist/swift/bin/',
      '/src/swift/bin/',
      '/swift/bin/',
    ],
  };

  const { path: cliPath } = findSecureBinaryPath(possiblePaths, config);

  if (!cliPath) {
    throw new Error(
      `EventKitCLI binary not found or validation failed. Searched: ${possiblePaths.join(', ')}`,
    );
  }

  // Detect which permission domain this action requires
  const domain = detectActionDomain(args);

  // Proactively trigger AppleScript permission prompt on first access
  // This ensures the permission dialog appears even in non-interactive contexts
  // where the Swift binary's native EventKit permission request may be suppressed
  if (!hasBeenPrompted(domain)) {
    await triggerPermissionPrompt(domain);
  }

  let hasRetried = false;

  while (true) {
    try {
      return await runCli<T>(cliPath, args);
    } catch (error) {
      // On permission error, trigger AppleScript prompt and retry once
      if (!hasRetried && error instanceof CliPermissionError) {
        hasRetried = true;
        await triggerPermissionPrompt(error.domain);
        continue;
      }
      throw error;
    }
  }
}
