/**
 * contactResolver.ts
 * Contact resolver service with caching and phone/email normalization.
 * Resolves phone numbers and email addresses to contact names.
 */

import { executeJxaWithRetry } from './jxaExecutor.js';

/**
 * Resolved contact information
 */
export interface ResolvedContact {
  id: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Contact cache entry with phone/email mappings
 */
interface ContactCacheEntry {
  id: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  phones: string[];
  emails: string[];
}

/**
 * Cache state
 */
interface CacheState {
  entries: Map<string, ResolvedContact>; // normalized handle -> contact
  timestamp: number;
  building: Promise<void> | null; // Lock to prevent duplicate fetches
}

/**
 * JXA script to fetch all contacts with phones and emails (10K safety limit)
 */
const BULK_FETCH_CONTACTS_SCRIPT = `
(() => {
  const Contacts = Application("Contacts");
  const people = Contacts.people();
  const result = [];
  const limit = Math.min(people.length, 10000);
  for (let i = 0; i < limit; i++) {
    const p = people[i];
    const phones = [];
    try {
      const ph = p.phones();
      for (let j = 0; j < ph.length; j++) {
        phones.push(ph[j].value());
      }
    } catch(e) {}
    const emails = [];
    try {
      const em = p.emails();
      for (let j = 0; j < em.length; j++) {
        emails.push(em[j].value());
      }
    } catch(e) {}
    if (phones.length > 0 || emails.length > 0) {
      result.push({
        id: p.id(),
        fullName: p.name() || "",
        firstName: p.firstName() || "",
        lastName: p.lastName() || "",
        phones: phones,
        emails: emails
      });
    }
  }
  return JSON.stringify(result);
})()
`;

/**
 * Default cache TTL in milliseconds (5 minutes)
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * ContactResolverService provides efficient contact resolution with caching.
 *
 * Features:
 * - Normalizes phone numbers (strips formatting, handles +country codes)
 * - Normalizes emails (lowercase, trim)
 * - LRU-style cache with 5-minute TTL
 * - Coalesces concurrent cache builds (single JXA call)
 * - Graceful degradation on permission failure
 */
export class ContactResolverService {
  private cache: CacheState = {
    entries: new Map(),
    timestamp: 0,
    building: null,
  };

  private cacheTtlMs: number;

  constructor(cacheTtlMs = CACHE_TTL_MS) {
    this.cacheTtlMs = cacheTtlMs;
  }

  /**
   * Normalizes a phone number by stripping all non-digit characters.
   * Handles various formats including +country codes.
   *
   * @example
   * normalizePhone("+15551234567") // "15551234567"
   * normalizePhone("(555) 123-4567") // "5551234567"
   * normalizePhone("555-123-4567") // "5551234567"
   */
  normalizePhone(phone: string): string {
    // Strip all non-digit characters
    const digits = phone.replace(/\D/g, '');
    return digits;
  }

  /**
   * Normalizes an email address (lowercase, trim).
   */
  normalizeEmail(email: string): string {
    return email.toLowerCase().trim();
  }

  /**
   * Determines if a handle looks like a phone number or email.
   */
  private isPhone(handle: string): boolean {
    // Contains mostly digits, or starts with + followed by digits
    const digits = handle.replace(/\D/g, '');
    return digits.length >= 7 && !handle.includes('@');
  }

  /**
   * Invalidates the cache, forcing a refresh on next resolve.
   */
  invalidateCache(): void {
    this.cache = {
      entries: new Map(),
      timestamp: 0,
      building: null,
    };
  }

  /**
   * Checks if the cache is still valid.
   * A cache with 0 entries but a valid timestamp is considered valid
   * (happens when Contacts permission is denied - we don't want to keep retrying).
   */
  private isCacheValid(): boolean {
    // Cache is valid if timestamp is set and not expired
    // Note: Empty cache (size === 0) with valid timestamp is OK - it means
    // either no contacts exist or permission was denied
    return (
      this.cache.timestamp > 0 &&
      Date.now() - this.cache.timestamp < this.cacheTtlMs
    );
  }

  /**
   * Builds the cache by fetching all contacts.
   * Uses a lock to prevent duplicate fetches when called concurrently.
   */
  private async buildCache(): Promise<void> {
    // If cache is still valid, no need to rebuild
    if (this.isCacheValid()) {
      return;
    }

    // If already building, wait for that promise (coalescing)
    if (this.cache.building) {
      await this.cache.building;
      return;
    }

    // Create a new build promise
    this.cache.building = this.doBuildCache();

    try {
      await this.cache.building;
    } finally {
      this.cache.building = null;
    }
  }

  /**
   * Actually performs the cache build (internal).
   */
  private async doBuildCache(): Promise<void> {
    const entries = new Map<string, ResolvedContact>();

    try {
      const contacts = await executeJxaWithRetry<ContactCacheEntry[]>(
        BULK_FETCH_CONTACTS_SCRIPT,
        60000, // 60s timeout for large contact lists
        'Contacts',
        2,
        1000,
      );

      for (const contact of contacts) {
        const resolved: ResolvedContact = {
          id: contact.id,
          fullName: contact.fullName,
          firstName: contact.firstName || undefined,
          lastName: contact.lastName || undefined,
        };

        // Index by normalized phones
        for (const phone of contact.phones) {
          const normalized = this.normalizePhone(phone);
          if (normalized) {
            entries.set(normalized, resolved);
            // Also index last 10 digits for matching without country code
            if (normalized.length > 10) {
              entries.set(normalized.slice(-10), resolved);
            }
          }
        }

        // Index by normalized emails
        for (const email of contact.emails) {
          const normalized = this.normalizeEmail(email);
          if (normalized) {
            entries.set(normalized, resolved);
          }
        }
      }

      this.cache = {
        entries,
        timestamp: Date.now(),
        building: null,
      };
    } catch (error) {
      // Graceful degradation: permission errors result in empty cache with valid timestamp
      // Use duck typing to check for isPermissionError (works with mocks)
      const isPermissionErr =
        error instanceof Error &&
        'isPermissionError' in error &&
        (error as { isPermissionError: boolean }).isPermissionError === true;

      if (isPermissionErr) {
        this.cache = {
          entries: new Map(),
          timestamp: Date.now(),
          building: null,
        };
        return;
      }
      // Re-throw other errors
      throw error;
    }
  }

  /**
   * Resolves a single phone number or email to a contact.
   *
   * @param handle - Phone number or email address
   * @returns Resolved contact or null if not found
   */
  async resolveHandle(handle: string): Promise<ResolvedContact | null> {
    try {
      await this.buildCache();
    } catch {
      // Graceful degradation: return null on any error
      return null;
    }

    const normalized = this.isPhone(handle)
      ? this.normalizePhone(handle)
      : this.normalizeEmail(handle);

    const result = this.cache.entries.get(normalized);
    if (result) {
      return result;
    }

    // For phones, also try last 10 digits match
    if (this.isPhone(handle) && normalized.length > 10) {
      return this.cache.entries.get(normalized.slice(-10)) ?? null;
    }

    return null;
  }

  /**
   * Resolves multiple phone numbers or emails to contacts in batch.
   *
   * @param handles - Array of phone numbers or email addresses
   * @returns Map of handle -> ResolvedContact (only includes found contacts)
   */
  async resolveBatch(handles: string[]): Promise<Map<string, ResolvedContact>> {
    const results = new Map<string, ResolvedContact>();

    try {
      await this.buildCache();
    } catch {
      // Graceful degradation: return empty map on any error
      return results;
    }

    for (const handle of handles) {
      const normalized = this.isPhone(handle)
        ? this.normalizePhone(handle)
        : this.normalizeEmail(handle);

      let contact = this.cache.entries.get(normalized);

      // For phones, also try last 10 digits match
      if (!contact && this.isPhone(handle) && normalized.length > 10) {
        contact = this.cache.entries.get(normalized.slice(-10));
      }

      if (contact) {
        results.set(handle, contact);
      }
    }

    return results;
  }

  /**
   * Gets the current cache size (for testing/debugging).
   */
  getCacheSize(): number {
    return this.cache.entries.size;
  }

  /**
   * Gets the cache timestamp (for testing/debugging).
   */
  getCacheTimestamp(): number {
    return this.cache.timestamp;
  }
}

/**
 * Singleton instance for use across the application.
 */
export const contactResolver = new ContactResolverService();
