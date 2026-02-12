/**
 * handlers/shared.ts
 * Shared helper functions for all handlers
 */

import type { ZodSchema } from 'zod/v3';
import type {
  CalendarsToolArgs,
  CalendarToolArgs,
  ContactsToolArgs,
  ListsToolArgs,
  MailToolArgs,
  MessagesToolArgs,
  NotesFoldersToolArgs,
  NotesToolArgs,
  RemindersToolArgs,
} from '../../types/index.js';
import { formatTimezoneInfo, getSystemTimezone } from '../../utils/timezone.js';
import { validateInput } from '../../validation/schemas.js';

/**
 * Extracts and validates arguments by removing action and validating the rest
 */
export const extractAndValidateArgs = <T>(
  args:
    | RemindersToolArgs
    | ListsToolArgs
    | CalendarToolArgs
    | CalendarsToolArgs
    | NotesToolArgs
    | NotesFoldersToolArgs
    | MailToolArgs
    | MessagesToolArgs
    | ContactsToolArgs
    | undefined,
  schema: ZodSchema<T>,
): T => {
  const { action: _, ...rest } = args ?? {};
  return validateInput(schema, rest);
};

/**
 * Options for formatListMarkdown
 */
export interface FormatListOptions {
  pagination?: { offset?: number; limit?: number };
  /** Include user's timezone in the response for time-sensitive data */
  includeTimezone?: boolean;
}

/**
 * Formats a list of items as markdown with header and empty state message
 */
export const formatListMarkdown = <T>(
  title: string,
  items: T[],
  formatItem: (item: T) => string[],
  emptyMessage: string,
  options?: FormatListOptions | { offset?: number; limit?: number },
): string => {
  // Support both old pagination-only signature and new options object
  const opts: FormatListOptions =
    options && ('includeTimezone' in options || 'pagination' in options)
      ? (options as FormatListOptions)
      : { pagination: options as { offset?: number; limit?: number } };

  const pagination = opts.pagination;
  let header: string;
  const offset = pagination?.offset ?? 0;
  const limit = pagination?.limit ?? 0;
  if (pagination && (offset > 0 || items.length === limit)) {
    const start = offset + 1;
    const end = offset + items.length;
    header = `### ${title} (Showing ${start}–${end})`;
  } else {
    header = `### ${title} (Total: ${items.length})`;
  }
  const lines: string[] = [header, ''];

  if (items.length === 0) {
    lines.push(emptyMessage);
  } else {
    items.forEach((item) => {
      lines.push(...formatItem(item));
    });
  }

  // Add timezone context for time-sensitive data
  if (opts.includeTimezone) {
    const tz = getSystemTimezone();
    lines.push('');
    lines.push(`*User timezone: ${formatTimezoneInfo(tz)}*`);
  }

  return lines.join('\n');
};

/**
 * Formats a success message with ID for created/updated items
 */
export const formatSuccessMessage = (
  action: 'created' | 'updated',
  itemType: string,
  title: string,
  id: string,
): string => {
  const actionText = action === 'created' ? 'created' : 'updated';
  const prefix =
    action === 'updated' && itemType === 'list'
      ? `Successfully updated ${itemType} to`
      : `Successfully ${actionText} ${itemType}`;
  return `${prefix} "${title}".\n- ID: ${id}`;
};

/**
 * Wraps a promise with a timeout. Returns the result or falls back to the
 * fallback value if the operation exceeds the timeout.
 *
 * @param promise - The promise to race against the timeout
 * @param timeoutMs - Timeout in milliseconds
 * @param fallback - Value returned if the timeout fires
 * @param label - Optional label for structured stderr logging on timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
  label?: string,
): Promise<T> {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve(fallback);
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    if (timedOut && label) {
      process.stderr.write(
        `${JSON.stringify({ timestamp: new Date().toISOString(), level: 'warn', event: 'enrichment_timeout', label, timeoutMs })}\n`,
      );
    }
    return result;
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Formats a delete success message
 */
export const formatDeleteMessage = (
  itemType: string,
  identifier: string,
  options: {
    useQuotes?: boolean;
    useIdPrefix?: boolean;
    usePeriod?: boolean;
    useColon?: boolean;
  } = {},
): string => {
  const {
    useQuotes = true,
    useIdPrefix = true,
    usePeriod = true,
    useColon = true,
  } = options;
  const formattedId = useQuotes ? `"${identifier}"` : identifier;
  let idPart: string;
  if (useIdPrefix) {
    const separator = useColon ? ': ' : ' ';
    idPart = `with ID${separator}${formattedId}`;
  } else {
    idPart = formattedId;
  }
  const period = usePeriod ? '.' : '';
  return `Successfully deleted ${itemType} ${idPart}${period}`;
};
