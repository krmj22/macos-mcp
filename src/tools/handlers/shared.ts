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
 * Formats a list of items as markdown with header and empty state message
 */
export const formatListMarkdown = <T>(
  title: string,
  items: T[],
  formatItem: (item: T) => string[],
  emptyMessage: string,
  pagination?: { offset?: number; limit?: number },
): string => {
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
