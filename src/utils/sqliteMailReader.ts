/**
 * sqliteMailReader.ts
 * Reads Mail data from ~/Library/Mail/V10/MailData/Envelope Index via SQLite.
 * Requires Full Disk Access to be granted in System Settings.
 *
 * Schema key tables:
 * - messages: ROWID, sender (FK→addresses), subject (FK→subjects), summary (FK→summaries),
 *   mailbox (FK→mailboxes), date_received (seconds since 2001-01-01), read, deleted, flags
 * - addresses: ROWID, address, comment (display name)
 * - subjects: ROWID, subject
 * - summaries: ROWID, summary (message preview text)
 * - mailboxes: ROWID, url, total_count, unread_count
 * - recipients: message (FK→messages), address (FK→addresses), type (0=to, 1=cc)
 *
 * See ADR-001 in DECISION.md for architectural context.
 */

import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MAIL_DB_PATH = join(
  homedir(),
  'Library',
  'Mail',
  'V10',
  'MailData',
  'Envelope Index',
);

export class SqliteMailAccessError extends Error {
  constructor(
    message: string,
    public readonly isPermissionError: boolean,
  ) {
    super(message);
    this.name = 'SqliteMailAccessError';
  }
}

function runSqlite(query: string, timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/sqlite3',
      ['-json', '-readonly', MAIL_DB_PATH, query],
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const msg = stderr || error.message;
          if (
            msg.includes('authorization denied') ||
            msg.includes('unable to open')
          ) {
            reject(
              new SqliteMailAccessError(
                'Cannot access Mail database. Grant Full Disk Access to your terminal app in System Settings > Privacy & Security > Full Disk Access.',
                true,
              ),
            );
            return;
          }
          reject(new SqliteMailAccessError(`SQLite error: ${msg}`, false));
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

/** Converts Mail's timestamp (Unix seconds) to ISO string. */
export function mailDateToISO(timestamp: number | null): string {
  if (!timestamp) return '';
  return new Date(timestamp * 1000).toISOString();
}

/**
 * Parses a mailbox URL to extract a human-readable mailbox name and account UUID.
 * Examples:
 * - `imap://UUID/%5BGmail%5D/All%20Mail` → { account: "UUID", mailbox: "All Mail" }
 * - `imap://UUID/INBOX` → { account: "UUID", mailbox: "INBOX" }
 * - `ews://UUID/Archive` → { account: "UUID", mailbox: "Archive" }
 */
export function parseMailboxUrl(url: string): {
  account: string;
  mailbox: string;
} {
  try {
    // Format: scheme://accountId/path/segments
    const withoutScheme = url.replace(/^[a-z]+:\/\//, '');
    const slashIndex = withoutScheme.indexOf('/');
    if (slashIndex === -1) return { account: withoutScheme, mailbox: url };

    const account = withoutScheme.substring(0, slashIndex);
    const pathEncoded = withoutScheme.substring(slashIndex + 1);
    const pathDecoded = decodeURIComponent(pathEncoded);

    // For Gmail paths like "[Gmail]/All Mail", take the last segment
    const segments = pathDecoded.split('/');
    const mailbox = segments[segments.length - 1] || pathDecoded;

    return { account, mailbox };
  } catch {
    return { account: '', mailbox: url };
  }
}

/** Escapes a string for safe use in SQLite LIKE/= clauses. */
function escapeSql(str: string): string {
  return str.replace(/'/g, "''");
}

// --- Interfaces ---

export interface MailMessage {
  id: string;
  subject: string;
  sender: string;
  senderName: string;
  dateReceived: string;
  read: boolean;
  mailbox: string;
  account: string;
  preview: string;
}

export interface MailMessageFull extends MailMessage {
  toRecipients: string[];
  ccRecipients: string[];
}

export interface MailboxInfo {
  name: string;
  account: string;
  url: string;
  totalCount: number;
  unreadCount: number;
}

// --- Raw SQLite row types ---

interface RawMailRow {
  ROWID: number;
  subject: string | null;
  address: string | null;
  comment: string | null;
  date_received: number | null;
  read: number;
  mailbox_url: string | null;
  summary: string | null;
}

interface RawMailFullRow extends RawMailRow {
  to_addresses: string | null;
  cc_addresses: string | null;
}

interface RawMailboxRow {
  url: string;
  total_count: number;
  unread_count: number;
}

// --- Row mapping ---

function mapMailRow(row: RawMailRow): MailMessage {
  const parsed = row.mailbox_url
    ? parseMailboxUrl(row.mailbox_url)
    : { account: '', mailbox: '' };
  return {
    id: String(row.ROWID),
    subject: row.subject || '(no subject)',
    sender: row.address || '',
    senderName: row.comment || '',
    dateReceived: mailDateToISO(row.date_received),
    read: row.read === 1,
    mailbox: parsed.mailbox,
    account: parsed.account,
    preview: (row.summary || '').substring(0, 200),
  };
}

// --- Core query fragments ---

const BASE_SELECT = `
  SELECT m.ROWID, s.subject, a.address, a.comment, m.date_received,
         m.read, mb.url as mailbox_url, sm.summary
  FROM messages m
  LEFT JOIN subjects s ON m.subject = s.ROWID
  LEFT JOIN addresses a ON m.sender = a.ROWID
  LEFT JOIN mailboxes mb ON m.mailbox = mb.ROWID
  LEFT JOIN summaries sm ON m.summary = sm.ROWID
`;

const SKIP_MAILBOXES = `
  AND mb.url NOT LIKE '%/Trash'
  AND mb.url NOT LIKE '%/Junk'
  AND mb.url NOT LIKE '%25Junk'
  AND mb.url NOT LIKE '%/Deleted%20Messages'
  AND mb.url NOT LIKE '%/Sent%20Mail'
  AND mb.url NOT LIKE '%/Sent%20Messages'
  AND mb.url NOT LIKE '%/Sent'
  AND mb.url NOT LIKE '%/Drafts'
`;

// --- Public API ---

/**
 * Lists inbox messages sorted by date (most recent first).
 *
 * Checks two sources:
 * 1. Messages whose mailbox URL ends in /INBOX (non-Gmail accounts)
 * 2. Messages labeled as INBOX via the `labels` table (Gmail stores messages
 *    in "All Mail" and uses labels for INBOX membership)
 */
export async function listInboxMessages(
  limit: number,
  offset: number,
): Promise<MailMessage[]> {
  const query = `
    ${BASE_SELECT}
    WHERE m.deleted = 0
    AND (
      LOWER(mb.url) LIKE '%/inbox'
      OR m.ROWID IN (
        SELECT l.message_id FROM labels l
        JOIN mailboxes imb ON l.mailbox_id = imb.ROWID
        WHERE LOWER(imb.url) LIKE '%/inbox'
      )
    )
    ORDER BY m.date_received DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  const output = await runSqlite(query);
  return parseSqliteJson<RawMailRow>(output).map(mapMailRow);
}

/**
 * Searches messages by subject, sender address, sender name, or summary content.
 */
export async function searchMessages(
  term: string,
  limit: number,
  offset: number,
): Promise<MailMessage[]> {
  const escaped = escapeSql(term);
  const query = `
    ${BASE_SELECT}
    WHERE m.deleted = 0
    ${SKIP_MAILBOXES}
    AND (
      s.subject LIKE '%${escaped}%'
      OR a.address LIKE '%${escaped}%'
      OR a.comment LIKE '%${escaped}%'
      OR sm.summary LIKE '%${escaped}%'
    )
    ORDER BY m.date_received DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  const output = await runSqlite(query);
  return parseSqliteJson<RawMailRow>(output).map(mapMailRow);
}

/**
 * Searches messages by sender email addresses (for contact reverse lookup).
 * Excludes Trash/Junk/Sent/Drafts.
 */
export async function searchBySenderEmails(
  emails: string[],
  limit: number,
): Promise<MailMessage[]> {
  if (emails.length === 0) return [];

  const conditions = emails
    .map((e) => `a.address LIKE '%${escapeSql(e)}%'`)
    .join(' OR ');

  const query = `
    ${BASE_SELECT}
    WHERE m.deleted = 0
    ${SKIP_MAILBOXES}
    AND (${conditions})
    ORDER BY m.date_received DESC
    LIMIT ${limit}
  `;
  const output = await runSqlite(query);
  return parseSqliteJson<RawMailRow>(output).map(mapMailRow);
}

/**
 * Gets a single message by ROWID with full recipient info.
 */
export async function getMessageById(
  rowId: string,
): Promise<MailMessageFull | null> {
  const escaped = escapeSql(rowId);
  const query = `
    SELECT m.ROWID, s.subject, a.address, a.comment, m.date_received,
           m.read, mb.url as mailbox_url, sm.summary,
           (
             SELECT GROUP_CONCAT(ra.address, ', ')
             FROM recipients r
             JOIN addresses ra ON r.address = ra.ROWID
             WHERE r.message = m.ROWID AND r.type = 0
           ) as to_addresses,
           (
             SELECT GROUP_CONCAT(ra.address, ', ')
             FROM recipients r
             JOIN addresses ra ON r.address = ra.ROWID
             WHERE r.message = m.ROWID AND r.type = 1
           ) as cc_addresses
    FROM messages m
    LEFT JOIN subjects s ON m.subject = s.ROWID
    LEFT JOIN addresses a ON m.sender = a.ROWID
    LEFT JOIN mailboxes mb ON m.mailbox = mb.ROWID
    LEFT JOIN summaries sm ON m.summary = sm.ROWID
    WHERE m.ROWID = ${escaped}
  `;
  const output = await runSqlite(query, 10000);
  const rows = parseSqliteJson<RawMailFullRow>(output);
  if (rows.length === 0) return null;

  const row = rows[0];
  const base = mapMailRow(row);
  return {
    ...base,
    toRecipients: row.to_addresses
      ? row.to_addresses.split(', ').filter(Boolean)
      : [],
    ccRecipients: row.cc_addresses
      ? row.cc_addresses.split(', ').filter(Boolean)
      : [],
  };
}

/**
 * Lists messages from a specific mailbox.
 *
 * Checks two sources:
 * 1. Messages directly in the mailbox (non-Gmail accounts)
 * 2. Messages labeled with this mailbox via the `labels` table (Gmail stores
 *    all messages in "All Mail" and uses labels for folder membership)
 */
export async function listMailboxMessages(
  mailboxUrl: string,
  limit: number,
  offset: number,
): Promise<MailMessage[]> {
  const escaped = escapeSql(mailboxUrl);
  const query = `
    ${BASE_SELECT}
    WHERE m.deleted = 0
    AND (
      mb.url = '${escaped}'
      OR m.ROWID IN (
        SELECT l.message_id FROM labels l
        JOIN mailboxes lmb ON l.mailbox_id = lmb.ROWID
        WHERE lmb.url = '${escaped}'
      )
    )
    ORDER BY m.date_received DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  const output = await runSqlite(query);
  return parseSqliteJson<RawMailRow>(output).map(mapMailRow);
}

/**
 * Lists all mailboxes with message counts.
 * Only returns mailboxes that have at least one message.
 */
export async function listMailboxes(): Promise<MailboxInfo[]> {
  const query = `
    SELECT url, total_count, unread_count
    FROM mailboxes
    WHERE total_count > 0
    ORDER BY total_count DESC
  `;
  const output = await runSqlite(query, 10000);
  const rows = parseSqliteJson<RawMailboxRow>(output);
  return rows.map((row) => {
    const parsed = parseMailboxUrl(row.url);
    return {
      name: parsed.mailbox,
      account: parsed.account,
      url: row.url,
      totalCount: row.total_count,
      unreadCount: row.unread_count,
    };
  });
}
