/**
 * sqliteMessageReader.ts
 * Reads Messages data from ~/Library/Messages/chat.db via SQLite.
 * Requires Full Disk Access to be granted in System Settings.
 */

import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CHAT_DB_PATH = join(homedir(), 'Library', 'Messages', 'chat.db');

export class SqliteAccessError extends Error {
  constructor(
    message: string,
    public readonly isPermissionError: boolean,
  ) {
    super(message);
    this.name = 'SqliteAccessError';
  }
}

function runSqlite(query: string, timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/sqlite3',
      ['-json', CHAT_DB_PATH, query],
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const msg = stderr || error.message;
          if (
            msg.includes('authorization denied') ||
            msg.includes('unable to open')
          ) {
            reject(
              new SqliteAccessError(
                'Cannot access Messages database. Grant Full Disk Access to your terminal app in System Settings > Privacy & Security > Full Disk Access.',
                true,
              ),
            );
            return;
          }
          reject(new SqliteAccessError(`SQLite error: ${msg}`, false));
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

function parseSqliteJson<T>(output: string): T[] {
  if (!output) return [];
  try {
    return JSON.parse(output) as T[];
  } catch {
    return [];
  }
}

interface SqliteMessage {
  ROWID: number;
  text: string | null;
  is_from_me: number;
  handle_id: string | null;
  date: number;
  attributedBody_hex: string | null;
  attachment_count: number;
}

/**
 * Extracts plain text from a hex-encoded NSKeyedArchiver attributedBody blob.
 * Apple stores rich text messages in this format instead of the plain text column.
 *
 * The blob format after NSString marker is typically:
 * - Control bytes (class info)
 * - '+' byte (0x2B) indicating string type
 * - Length byte
 * - UTF-8 text content
 */
function extractTextFromAttributedBody(
  hexString: string | null,
): string | null {
  if (!hexString) return null;

  try {
    const buffer = Buffer.from(hexString, 'hex');

    // Find "NSString" marker
    const nsStringMarker = Buffer.from('NSString');
    const markerIndex = buffer.indexOf(nsStringMarker);
    if (markerIndex === -1) return null;

    // Search for the '+' marker followed by length byte, then text
    const searchStart = markerIndex + nsStringMarker.length;
    let pos = searchStart;

    // Skip control bytes until we find '+' (0x2B) which indicates string data
    while (pos < buffer.length && buffer[pos] !== 0x2b) {
      pos++;
    }

    if (pos >= buffer.length - 2) return null;

    // Skip '+' marker and length byte
    pos += 2;

    // Now we're at the start of the actual text
    const textStart = pos;

    // Find where the text ends (control char 0x86 or 0x84 typically marks end)
    let textEnd = textStart;
    while (textEnd < buffer.length) {
      const byte = buffer[textEnd];
      // Stop at blob markers that indicate end of string content
      if (byte === 0x86 || byte === 0x84) break;
      textEnd++;
    }

    if (textEnd > textStart) {
      const text = buffer.subarray(textStart, textEnd).toString('utf8');
      // Clean up any trailing non-printable control chars
      let end = text.length;
      while (end > 0) {
        const code = text.charCodeAt(end - 1);
        if ((code >= 0x20 && code < 0x7f) || code > 0x9f) break;
        end--;
      }
      return text.slice(0, end).trim();
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Gets the display text for a message, falling back to attributedBody extraction.
 * Returns '[Attachment]' for attachment-only messages.
 */
function getMessageText(
  text: string | null,
  attributedBodyHex: string | null,
  attachmentCount: number,
): string {
  // Try plain text first
  if (text?.trim()) {
    return text;
  }

  // Try extracting from attributedBody
  const extracted = extractTextFromAttributedBody(attributedBodyHex);
  if (extracted?.trim()) {
    return extracted;
  }

  // If there's an attachment but no text, indicate that
  if (attachmentCount > 0) {
    return '[Attachment]';
  }

  return '';
}

/**
 * Converts Apple's Core Data timestamp (nanoseconds since 2001-01-01) to ISO string.
 */
function appleTimestampToISO(timestamp: number): string {
  if (!timestamp) return '';
  // Apple timestamps in chat.db are nanoseconds since 2001-01-01
  const appleEpoch = new Date('2001-01-01T00:00:00Z').getTime();
  const ms = appleEpoch + timestamp / 1_000_000;
  return new Date(ms).toISOString();
}

/**
 * Date range filter for SQLite message queries.
 * Dates are converted to Apple Core Data timestamps (nanoseconds since 2001-01-01).
 */
export interface DateRange {
  startDate?: string;
  endDate?: string;
}

/**
 * Apple epoch: 2001-01-01T00:00:00Z in Unix milliseconds.
 */
const APPLE_EPOCH_MS = new Date('2001-01-01T00:00:00Z').getTime();

/**
 * Parses a date string and converts it to Apple Core Data timestamp (nanoseconds since 2001-01-01).
 * Supports: 'YYYY-MM-DD', 'YYYY-MM-DD HH:mm:ss', ISO 8601.
 * Returns null if the date string is invalid.
 */
export function dateToAppleTimestamp(dateStr: string): number | null {
  // Try parsing as-is (handles ISO 8601 and 'YYYY-MM-DDTHH:mm:ss')
  let d = new Date(dateStr);

  // If that didn't work, try 'YYYY-MM-DD HH:mm:ss' by replacing space with T
  if (Number.isNaN(d.getTime())) {
    d = new Date(dateStr.replace(' ', 'T'));
  }

  if (Number.isNaN(d.getTime())) {
    return null;
  }

  // Convert Unix ms to Apple nanoseconds
  const unixMs = d.getTime();
  return (unixMs - APPLE_EPOCH_MS) * 1_000_000;
}

/**
 * Builds SQL WHERE clause fragment for date range filtering.
 * Uses pre-computed numeric Apple timestamps (safe from injection).
 * Returns empty string if no date filtering is needed.
 */
export function buildDateFilter(
  dateRange?: DateRange,
  messageAlias = 'm',
): string {
  if (!dateRange) return '';

  const clauses: string[] = [];

  if (dateRange.startDate) {
    const ts = dateToAppleTimestamp(dateRange.startDate);
    if (ts !== null) {
      clauses.push(`${messageAlias}.date >= ${ts}`);
    }
  }

  if (dateRange.endDate) {
    const ts = dateToAppleTimestamp(dateRange.endDate);
    if (ts !== null) {
      clauses.push(`${messageAlias}.date <= ${ts}`);
    }
  }

  if (clauses.length === 0) return '';
  return clauses.map((c) => `AND ${c}`).join(' ');
}

export interface ReadMessageResult {
  id: string;
  text: string;
  sender: string;
  date: string;
  isFromMe: boolean;
}

export interface ReadChatResult {
  id: string;
  name: string;
  participants: string[];
  lastMessage: string;
  lastDate: string;
}

/**
 * Read messages from a specific chat by chat ID (the guid like "iMessage;-;+1234567890").
 */
export async function readChatMessages(
  chatId: string,
  limit: number,
  offset: number,
  dateRange?: DateRange,
): Promise<ReadMessageResult[]> {
  const escapedId = chatId.replace(/'/g, "''");
  const dateFilter = buildDateFilter(dateRange);
  const query = `
    SELECT m.ROWID, m.text, m.is_from_me, m.date,
           COALESCE(h.id, '') as handle_id,
           hex(m.attributedBody) as attributedBody_hex,
           (SELECT COUNT(*) FROM message_attachment_join maj WHERE maj.message_id = m.ROWID) as attachment_count
    FROM message m
    LEFT JOIN handle h ON m.handle_id = h.ROWID
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    JOIN chat c ON c.ROWID = cmj.chat_id
    WHERE c.guid = '${escapedId}'
    ${dateFilter}
    ORDER BY m.date DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  const output = await runSqlite(query);
  const rows = parseSqliteJson<SqliteMessage & { handle_id: string }>(output);
  return rows.reverse().map((row) => ({
    id: String(row.ROWID),
    text: getMessageText(
      row.text,
      row.attributedBody_hex,
      row.attachment_count,
    ),
    sender: row.is_from_me ? 'me' : row.handle_id || 'unknown',
    date: appleTimestampToISO(row.date),
    isFromMe: row.is_from_me === 1,
  }));
}

/**
 * Search messages across all chats by text content.
 * Searches both the text column and attributedBody for matches.
 */
export async function searchMessages(
  searchTerm: string,
  limit: number,
  dateRange?: DateRange,
): Promise<
  Array<
    ReadMessageResult & {
      chatId: string;
      chatName: string;
    }
  >
> {
  const escapedTerm = searchTerm.replace(/'/g, "''");
  const dateFilter = buildDateFilter(dateRange);
  const query = `
    SELECT m.ROWID, m.text, m.is_from_me, m.date,
           COALESCE(h.id, '') as handle_id,
           c.guid as chat_guid,
           COALESCE(c.display_name, '') as chat_name,
           hex(m.attributedBody) as attributedBody_hex,
           (SELECT COUNT(*) FROM message_attachment_join maj WHERE maj.message_id = m.ROWID) as attachment_count
    FROM message m
    LEFT JOIN handle h ON m.handle_id = h.ROWID
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    JOIN chat c ON c.ROWID = cmj.chat_id
    WHERE (m.text LIKE '%${escapedTerm}%'
       OR CAST(m.attributedBody AS TEXT) LIKE '%${escapedTerm}%')
    ${dateFilter}
    ORDER BY m.date DESC
    LIMIT ${limit}
  `;
  const output = await runSqlite(query, 30000);
  const rows = parseSqliteJson<
    SqliteMessage & { handle_id: string; chat_guid: string; chat_name: string }
  >(output);
  return rows.map((row) => ({
    id: String(row.ROWID),
    text: getMessageText(
      row.text,
      row.attributedBody_hex,
      row.attachment_count,
    ),
    sender: row.is_from_me ? 'me' : row.handle_id || 'unknown',
    date: appleTimestampToISO(row.date),
    isFromMe: row.is_from_me === 1,
    chatId: row.chat_guid,
    chatName: row.chat_name || row.chat_guid,
  }));
}

/**
 * Get the last message for a chat (for enriching chat listings).
 */
export async function getLastMessage(
  chatGuid: string,
): Promise<{ text: string; date: string } | null> {
  const escapedId = chatGuid.replace(/'/g, "''");
  const query = `
    SELECT m.text, m.date,
           hex(m.attributedBody) as attributedBody_hex,
           (SELECT COUNT(*) FROM message_attachment_join maj WHERE maj.message_id = m.ROWID) as attachment_count
    FROM message m
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    JOIN chat c ON c.ROWID = cmj.chat_id
    WHERE c.guid = '${escapedId}'
    ORDER BY m.date DESC
    LIMIT 1
  `;
  const output = await runSqlite(query, 5000);
  const rows = parseSqliteJson<{
    text: string | null;
    date: number;
    attributedBody_hex: string | null;
    attachment_count: number;
  }>(output);
  if (rows.length === 0) return null;
  const text = getMessageText(
    rows[0].text,
    rows[0].attributedBody_hex,
    rows[0].attachment_count,
  );
  return {
    text: text.substring(0, 100),
    date: appleTimestampToISO(rows[0].date),
  };
}

/**
 * List all chats from the Messages database.
 * Returns chats with their last message and participants.
 */
export async function listChats(
  limit: number,
  offset: number,
): Promise<ReadChatResult[]> {
  // Query chats with their last message and participant handles
  const query = `
    SELECT
      c.guid as chat_guid,
      COALESCE(c.display_name, '') as display_name,
      (
        SELECT GROUP_CONCAT(h.id, ', ')
        FROM chat_handle_join chj
        JOIN handle h ON h.ROWID = chj.handle_id
        WHERE chj.chat_id = c.ROWID
      ) as participants,
      (
        SELECT m.text
        FROM message m
        JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
        WHERE cmj.chat_id = c.ROWID
        ORDER BY m.date DESC
        LIMIT 1
      ) as last_message,
      (
        SELECT hex(m.attributedBody)
        FROM message m
        JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
        WHERE cmj.chat_id = c.ROWID
        ORDER BY m.date DESC
        LIMIT 1
      ) as last_message_attr_hex,
      (
        SELECT (SELECT COUNT(*) FROM message_attachment_join maj WHERE maj.message_id = m.ROWID)
        FROM message m
        JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
        WHERE cmj.chat_id = c.ROWID
        ORDER BY m.date DESC
        LIMIT 1
      ) as last_message_attach_count,
      (
        SELECT m.date
        FROM message m
        JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
        WHERE cmj.chat_id = c.ROWID
        ORDER BY m.date DESC
        LIMIT 1
      ) as last_date
    FROM chat c
    WHERE last_date IS NOT NULL
    ORDER BY last_date DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const output = await runSqlite(query, 15000);
  const rows = parseSqliteJson<{
    chat_guid: string;
    display_name: string;
    participants: string | null;
    last_message: string | null;
    last_message_attr_hex: string | null;
    last_message_attach_count: number | null;
    last_date: number | null;
  }>(output);

  return rows.map((row) => {
    const participants = row.participants
      ? row.participants.split(', ').filter((p) => p.trim())
      : [];
    const name =
      row.display_name || participants.join(', ') || row.chat_guid || 'Unknown';
    const lastMessage = getMessageText(
      row.last_message,
      row.last_message_attr_hex,
      row.last_message_attach_count ?? 0,
    );
    return {
      id: row.chat_guid,
      name,
      participants,
      lastMessage: lastMessage.substring(0, 100),
      lastDate: row.last_date ? appleTimestampToISO(row.last_date) : '',
    };
  });
}

/**
 * Read messages from handles (phone numbers or emails).
 * Used for reverse lookup by contact name.
 */
export async function readMessagesByHandles(
  handles: string[],
  limit: number,
  dateRange?: DateRange,
): Promise<
  Array<
    ReadMessageResult & {
      chatId: string;
      chatName: string;
    }
  >
> {
  if (handles.length === 0) {
    return [];
  }

  // Build OR conditions for each handle
  // We need to normalize handles to match Messages DB format
  const handleConditions = handles
    .map((h) => {
      const escaped = h.replace(/'/g, "''");
      // Messages DB stores handles like "+15551234567" or "email@example.com"
      // We'll match by suffix for phone numbers (to handle country code variations)
      // and exact match for emails
      if (h.includes('@')) {
        return `h.id = '${escaped}'`;
      }
      // For phone numbers, match last 10 digits using LIKE
      const last10 = h.slice(-10);
      return `h.id LIKE '%${last10}'`;
    })
    .join(' OR ');

  const dateFilter = buildDateFilter(dateRange);
  const query = `
    SELECT m.ROWID, m.text, m.is_from_me, m.date,
           COALESCE(h.id, '') as handle_id,
           c.guid as chat_guid,
           COALESCE(c.display_name, '') as chat_name,
           hex(m.attributedBody) as attributedBody_hex,
           (SELECT COUNT(*) FROM message_attachment_join maj WHERE maj.message_id = m.ROWID) as attachment_count
    FROM message m
    LEFT JOIN handle h ON m.handle_id = h.ROWID
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    JOIN chat c ON c.ROWID = cmj.chat_id
    WHERE (${handleConditions})
    ${dateFilter}
    ORDER BY m.date DESC
    LIMIT ${limit}
  `;

  const output = await runSqlite(query, 30000);
  const rows = parseSqliteJson<
    SqliteMessage & { handle_id: string; chat_guid: string; chat_name: string }
  >(output);

  return rows.map((row) => ({
    id: String(row.ROWID),
    text: getMessageText(
      row.text,
      row.attributedBody_hex,
      row.attachment_count,
    ),
    sender: row.is_from_me ? 'me' : row.handle_id || 'unknown',
    date: appleTimestampToISO(row.date),
    isFromMe: row.is_from_me === 1,
    chatId: row.chat_guid,
    chatName: row.chat_name || row.chat_guid,
  }));
}
