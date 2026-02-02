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
          if (msg.includes('authorization denied') || msg.includes('unable to open')) {
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
): Promise<ReadMessageResult[]> {
  const escapedId = chatId.replace(/'/g, "''");
  const query = `
    SELECT m.ROWID, m.text, m.is_from_me, m.date,
           COALESCE(h.id, '') as handle_id
    FROM message m
    LEFT JOIN handle h ON m.handle_id = h.ROWID
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    JOIN chat c ON c.ROWID = cmj.chat_id
    WHERE c.guid = '${escapedId}'
    ORDER BY m.date DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  const output = await runSqlite(query);
  const rows = parseSqliteJson<SqliteMessage & { handle_id: string }>(output);
  return rows.reverse().map((row) => ({
    id: String(row.ROWID),
    text: row.text || '',
    sender: row.is_from_me ? 'me' : (row.handle_id || 'unknown'),
    date: appleTimestampToISO(row.date),
    isFromMe: row.is_from_me === 1,
  }));
}

/**
 * Search messages across all chats by text content.
 */
export async function searchMessages(
  searchTerm: string,
  limit: number,
): Promise<
  Array<
    ReadMessageResult & {
      chatId: string;
      chatName: string;
    }
  >
> {
  const escapedTerm = searchTerm.replace(/'/g, "''");
  const query = `
    SELECT m.ROWID, m.text, m.is_from_me, m.date,
           COALESCE(h.id, '') as handle_id,
           c.guid as chat_guid,
           COALESCE(c.display_name, '') as chat_name
    FROM message m
    LEFT JOIN handle h ON m.handle_id = h.ROWID
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    JOIN chat c ON c.ROWID = cmj.chat_id
    WHERE m.text LIKE '%${escapedTerm}%'
    ORDER BY m.date DESC
    LIMIT ${limit}
  `;
  const output = await runSqlite(query, 30000);
  const rows = parseSqliteJson<
    SqliteMessage & { handle_id: string; chat_guid: string; chat_name: string }
  >(output);
  return rows.map((row) => ({
    id: String(row.ROWID),
    text: row.text || '',
    sender: row.is_from_me ? 'me' : (row.handle_id || 'unknown'),
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
    SELECT m.text, m.date
    FROM message m
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    JOIN chat c ON c.ROWID = cmj.chat_id
    WHERE c.guid = '${escapedId}'
    ORDER BY m.date DESC
    LIMIT 1
  `;
  const output = await runSqlite(query, 5000);
  const rows = parseSqliteJson<{ text: string | null; date: number }>(output);
  if (rows.length === 0) return null;
  return {
    text: (rows[0].text || '').substring(0, 100),
    date: appleTimestampToISO(rows[0].date),
  };
}
