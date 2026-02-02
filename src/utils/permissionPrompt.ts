/**
 * permissionPrompt.ts
 * Triggers macOS permission prompts via AppleScript fallbacks.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type PermissionDomain = 'reminders' | 'calendars';

const APPLESCRIPT_SNIPPETS: Record<PermissionDomain, string> = {
  reminders: 'tell application "Reminders" to get the name of every list',
  calendars: 'tell application "Calendar" to get the name of every calendar',
};

const promptedDomains = new Set<PermissionDomain>();

/**
 * Triggers the corresponding AppleScript to surface a macOS permission dialog.
 * Uses simple memoization to avoid spawning duplicate dialogs.
 *
 * This function is designed to be called proactively before the first Swift CLI call
 * to ensure permission dialogs appear even in non-interactive contexts where the
 * Swift binary's native EventKit permission request may be suppressed.
 */
export async function triggerPermissionPrompt(
  domain: PermissionDomain,
): Promise<void> {
  if (promptedDomains.has(domain)) {
    return;
  }

  const script = APPLESCRIPT_SNIPPETS[domain];

  try {
    await execFileAsync('osascript', ['-e', script]);
    promptedDomains.add(domain);
  } catch {
    // Mark as prompted even on error to avoid infinite retry loops
    // The error might be due to permission denial, which we'll handle downstream
    promptedDomains.add(domain);
  }
}

export function hasBeenPrompted(domain: PermissionDomain): boolean {
  return promptedDomains.has(domain);
}

export function resetPromptedDomains(): void {
  promptedDomains.clear();
}
