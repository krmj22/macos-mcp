/**
 * errorHandling.ts
 * Centralized error handling utilities for consistent error responses
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ValidationError } from '../validation/schemas.js';
import { JxaError } from './jxaExecutor.js';

/**
 * Deep-link URLs for macOS System Settings panes.
 * Used to provide actionable "how to fix" paths in error messages.
 */
export const SYSTEM_SETTINGS = {
  AUTOMATION:
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
  FULL_DISK_ACCESS:
    'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
  REMINDERS:
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders',
  CALENDARS:
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars',
  CONTACTS:
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts',
} as const;

/**
 * Creates an actionable hint for EventKit (Swift CLI) permission errors.
 * Includes the System Settings deep-link URL so the user can fix it immediately.
 */
export function createCliPermissionHint(domain: 'reminders' | 'calendars'): string {
  const settingsUrl =
    domain === 'reminders'
      ? SYSTEM_SETTINGS.REMINDERS
      : SYSTEM_SETTINGS.CALENDARS;
  const appName = domain === 'reminders' ? 'Reminders' : 'Calendars';
  return `Grant ${appName} access in System Settings > Privacy & Security > ${appName}. Open settings: ${settingsUrl}`;
}

/**
 * Creates an actionable hint for Full Disk Access errors on SQLite databases.
 * Includes the System Settings deep-link URL for FDA.
 */
export function createFdaHint(dbName: string): string {
  return `Grant Full Disk Access to your terminal app (or the actual node binary for LaunchAgent) in System Settings > Privacy & Security > Full Disk Access. Open settings: ${SYSTEM_SETTINGS.FULL_DISK_ACCESS} (${dbName} database)`;
}

/**
 * Creates a user-friendly error message for known JXA failure modes.
 */
function createJxaHint(error: JxaError): string | null {
  const msg = `${error.message} ${error.stderr ?? ''}`;
  if (/timed?\s*out/i.test(msg)) {
    return `${error.app} did not respond in time. The app may be busy or unresponsive — try again or restart ${error.app}.`;
  }
  if (/connection invalid/i.test(msg) || /connection is invalid/i.test(msg)) {
    return `Lost connection to ${error.app}. The app may have been quit or restarted — try again.`;
  }
  if (/not running/i.test(msg) || /Can.t get application/i.test(msg)) {
    return `${error.app} does not appear to be running. Open ${error.app} and try again.`;
  }
  if (
    /not authorized/i.test(msg) ||
    /permission/i.test(msg) ||
    /not allowed/i.test(msg)
  ) {
    return `${error.app} automation permission denied. Grant access in System Settings > Privacy & Security > Automation. Open settings: ${SYSTEM_SETTINGS.AUTOMATION}`;
  }
  return null;
}

/**
 * Creates a descriptive error message from the thrown value.
 * Error.message is surfaced in all modes; non-Error throws get a generic message.
 * Stack traces are never included.
 */
function createErrorMessage(operation: string, error: unknown): string {
  const message =
    error instanceof Error ? error.message : 'System error occurred';

  // For validation errors, always return the detailed message.
  if (error instanceof ValidationError) {
    return message;
  }

  // For JXA errors, provide user-friendly hints when possible.
  if (error instanceof JxaError) {
    const hint = createJxaHint(error);
    if (hint) return `Failed to ${operation}: ${hint}`;
  }

  // Show Error.message for Error instances, generic message for non-Error throws.
  // Stack traces are never included — only the message string.
  return `Failed to ${operation}: ${message}`;
}

/**
 * Utility for handling async operations with consistent error handling
 */
export async function handleAsyncOperation(
  operation: () => Promise<string>,
  operationName: string,
): Promise<CallToolResult> {
  try {
    const result = await operation();
    return {
      content: [{ type: 'text', text: result }],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: createErrorMessage(operationName, error),
        },
      ],
      isError: true,
    };
  }
}
