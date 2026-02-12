/**
 * sqliteContactReader.ts
 * Reads Contact data from ~/Library/Application Support/AddressBook/Sources/{id}/AddressBook-v22.abcddb via SQLite.
 * No Full Disk Access required — files are user-owned (644).
 *
 * Bulk reads for the enrichment cache (handle-to-name resolution).
 * Targeted search (name-to-handles) still uses JXA whose() in contactResolver.ts.
 *
 * Schema key tables (CoreData AddressBook):
 * - ZABCDRECORD: Z_PK, ZFIRSTNAME, ZLASTNAME, ZORGANIZATION, ZUNIQUEID, Z_ENT
 *   - Z_ENT 22 = ABCDContact (regular), Z_ENT 23 = ABCDSubscribedContact (Exchange/shared)
 * - ZABCDEMAILADDRESS: ZOWNER (FK→ZABCDRECORD.Z_PK), ZADDRESSNORMALIZED
 * - ZABCDPHONENUMBER: ZOWNER (FK→ZABCDRECORD.Z_PK), ZFULLNUMBER
 *
 * Two separate queries per source DB to avoid cartesian product:
 * a contact with 3 emails + 3 phones would produce 9 rows with a single JOIN.
 *
 * See ADR-002 in DECISION.md for architectural context.
 */

import { execFile } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ADDRESSBOOK_BASE = join(
  homedir(),
  'Library',
  'Application Support',
  'AddressBook',
  'Sources',
);

const DB_FILENAME = 'AddressBook-v22.abcddb';

export class SqliteContactAccessError extends Error {
  constructor(
    message: string,
    public readonly isPermissionError: boolean,
  ) {
    super(message);
    this.name = 'SqliteContactAccessError';
  }
}

export interface ContactEntry {
  id: string;
  fullName: string;
  firstName: string;
  lastName: string;
  phones: string[];
  emails: string[];
}

// --- Database discovery (cached) ---

let cachedDbPaths: string[] | null = null;

/**
 * Discovers all AddressBook source database paths.
 * Result is cached for the process lifetime (paths don't change at runtime).
 */
export function findContactDatabases(): string[] {
  if (cachedDbPaths !== null) {
    return cachedDbPaths;
  }

  if (!existsSync(ADDRESSBOOK_BASE)) {
    cachedDbPaths = [];
    return cachedDbPaths;
  }

  const entries = readdirSync(ADDRESSBOOK_BASE, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const dbPath = join(ADDRESSBOOK_BASE, entry.name, DB_FILENAME);
      if (existsSync(dbPath)) {
        paths.push(dbPath);
      }
    }
  }

  cachedDbPaths = paths;
  return cachedDbPaths;
}

/**
 * Resets the cached database paths. For testing only.
 */
export function resetDbPathCache(): void {
  cachedDbPaths = null;
}

// --- SQLite execution ---

function runSqlite(dbPath: string, query: string, timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/sqlite3',
      ['-json', '-readonly', dbPath, query],
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const msg = stderr || error.message;
          if (
            msg.includes('authorization denied') ||
            msg.includes('unable to open')
          ) {
            reject(
              new SqliteContactAccessError(
                `Cannot access Contacts database at ${dbPath}. Grant Contacts access in System Settings > Privacy & Security > Contacts.`,
                true,
              ),
            );
            return;
          }
          reject(new SqliteContactAccessError(`SQLite error: ${msg}`, false));
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

// --- SQL queries ---

const CONTACTS_WITH_EMAILS_QUERY = `
  SELECT r.Z_PK, r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, r.ZUNIQUEID,
         e.ZADDRESSNORMALIZED as email
  FROM ZABCDRECORD r
  JOIN ZABCDEMAILADDRESS e ON e.ZOWNER = r.Z_PK
  WHERE r.Z_ENT IN (22, 23)
`;

const CONTACTS_WITH_PHONES_QUERY = `
  SELECT r.Z_PK, r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, r.ZUNIQUEID,
         p.ZFULLNUMBER as phone
  FROM ZABCDRECORD r
  JOIN ZABCDPHONENUMBER p ON p.ZOWNER = r.Z_PK
  WHERE r.Z_ENT IN (22, 23)
`;

// --- Raw row types ---

interface RawEmailRow {
  Z_PK: number;
  ZFIRSTNAME: string | null;
  ZLASTNAME: string | null;
  ZORGANIZATION: string | null;
  ZUNIQUEID: string;
  email: string;
}

interface RawPhoneRow {
  Z_PK: number;
  ZFIRSTNAME: string | null;
  ZLASTNAME: string | null;
  ZORGANIZATION: string | null;
  ZUNIQUEID: string;
  phone: string;
}

// --- Name building ---

/**
 * Constructs a display name from parts, falling back to org if no first/last name.
 */
export function buildFullName(
  first: string | null,
  last: string | null,
  org: string | null,
): string {
  const parts: string[] = [];
  if (first) parts.push(first);
  if (last) parts.push(last);
  if (parts.length > 0) return parts.join(' ');
  if (org) return org;
  return '';
}

// --- Core fetch ---

/**
 * Fetches all contacts from a single source database.
 * Returns a Map keyed by ZUNIQUEID for easy merging.
 */
async function fetchFromSource(dbPath: string): Promise<Map<string, ContactEntry>> {
  const [emailOutput, phoneOutput] = await Promise.all([
    runSqlite(dbPath, CONTACTS_WITH_EMAILS_QUERY),
    runSqlite(dbPath, CONTACTS_WITH_PHONES_QUERY),
  ]);

  const emailRows = parseSqliteJson<RawEmailRow>(emailOutput);
  const phoneRows = parseSqliteJson<RawPhoneRow>(phoneOutput);

  const contacts = new Map<string, ContactEntry>();

  for (const row of emailRows) {
    let entry = contacts.get(row.ZUNIQUEID);
    if (!entry) {
      entry = {
        id: row.ZUNIQUEID,
        fullName: buildFullName(row.ZFIRSTNAME, row.ZLASTNAME, row.ZORGANIZATION),
        firstName: row.ZFIRSTNAME || '',
        lastName: row.ZLASTNAME || '',
        phones: [],
        emails: [],
      };
      contacts.set(row.ZUNIQUEID, entry);
    }
    if (row.email) {
      entry.emails.push(row.email);
    }
  }

  for (const row of phoneRows) {
    let entry = contacts.get(row.ZUNIQUEID);
    if (!entry) {
      entry = {
        id: row.ZUNIQUEID,
        fullName: buildFullName(row.ZFIRSTNAME, row.ZLASTNAME, row.ZORGANIZATION),
        firstName: row.ZFIRSTNAME || '',
        lastName: row.ZLASTNAME || '',
        phones: [],
        emails: [],
      };
      contacts.set(row.ZUNIQUEID, entry);
    }
    if (row.phone) {
      entry.phones.push(row.phone);
    }
  }

  return contacts;
}

/**
 * Fetches all contacts from all AddressBook source databases.
 * Queries all sources in parallel, merges by ZUNIQUEID, deduplicates.
 * If one source fails, logs warning and continues with remaining sources.
 * Throws SqliteContactAccessError only if ALL sources fail.
 */
export async function fetchAllContacts(): Promise<ContactEntry[]> {
  const dbPaths = findContactDatabases();

  if (dbPaths.length === 0) {
    return [];
  }

  const results = await Promise.allSettled(dbPaths.map(fetchFromSource));

  const merged = new Map<string, ContactEntry>();
  let successCount = 0;
  let lastError: Error | null = null;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      successCount++;
      for (const [uniqueId, entry] of result.value) {
        if (!merged.has(uniqueId)) {
          merged.set(uniqueId, entry);
        }
        // If already present from another source, same contact — skip (dedup by ZUNIQUEID)
      }
    } else {
      lastError = result.reason instanceof Error ? result.reason : new Error(String(result.reason));
      process.stderr.write(
        `${JSON.stringify({ timestamp: new Date().toISOString(), level: 'warn', event: 'contact_source_failed', dbPath: dbPaths[i], error: lastError.message })}\n`,
      );
    }
  }

  if (successCount === 0 && lastError) {
    if (lastError instanceof SqliteContactAccessError) {
      throw lastError;
    }
    throw new SqliteContactAccessError(lastError.message, false);
  }

  return Array.from(merged.values());
}
