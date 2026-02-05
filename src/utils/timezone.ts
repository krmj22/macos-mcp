/**
 * timezone.ts
 * Utilities for detecting and formatting system timezone information
 */

export interface TimezoneInfo {
  /** IANA timezone name (e.g., "America/New_York", "America/Los_Angeles") */
  name: string;
  /** Short abbreviation (e.g., "EST", "PST") */
  abbreviation: string;
  /** UTC offset in hours (e.g., -5, -8) */
  offsetHours: number;
  /** Formatted offset string (e.g., "UTC-05:00", "UTC-08:00") */
  offsetString: string;
}

/**
 * Gets the system's current timezone information.
 * Uses Intl API which reflects the system timezone setting.
 */
export function getSystemTimezone(): TimezoneInfo {
  const now = new Date();

  // Get IANA timezone name
  const name = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Get abbreviation (e.g., "EST", "PST")
  const abbreviation =
    new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
      .formatToParts(now)
      .find((part) => part.type === 'timeZoneName')?.value ?? '';

  // Calculate UTC offset in hours
  const offsetMinutes = now.getTimezoneOffset();
  const offsetHours = -offsetMinutes / 60; // getTimezoneOffset returns opposite sign

  // Format offset string (e.g., "UTC-05:00")
  const sign = offsetHours >= 0 ? '+' : '-';
  const absHours = Math.abs(Math.floor(offsetHours));
  const mins = Math.abs(offsetMinutes % 60);
  const offsetString = `UTC${sign}${String(absHours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;

  return {
    name,
    abbreviation,
    offsetHours,
    offsetString,
  };
}

/**
 * Formats timezone info as a short string for display.
 * Example: "America/New_York (EST, UTC-05:00)"
 */
export function formatTimezoneInfo(tz: TimezoneInfo): string {
  return `${tz.name} (${tz.abbreviation}, ${tz.offsetString})`;
}
