/**
 * handlers/calendarHandlers.ts
 * Handlers for calendar event operations
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type {
  CalendarEvent,
  CalendarsToolArgs,
  CalendarToolArgs,
} from '../../types/index.js';
import { calendarRepository } from '../../utils/calendarRepository.js';
import { contactResolver } from '../../utils/contactResolver.js';
import { handleAsyncOperation } from '../../utils/errorHandling.js';
import { formatMultilineNotes } from '../../utils/helpers.js';
import {
  CreateCalendarEventSchema,
  DeleteCalendarEventSchema,
  ReadCalendarEventsSchema,
  ReadCalendarsSchema,
  UpdateCalendarEventSchema,
} from '../../validation/schemas.js';
import {
  extractAndValidateArgs,
  formatDeleteMessage,
  formatListMarkdown,
  formatSuccessMessage,
  withTimeout,
} from './shared.js';

/**
 * Enriches event attendees by resolving email addresses to contact names.
 * Unknown attendees gracefully fall back to their raw email addresses.
 *
 * @param events - Array of calendar events to enrich
 * @returns Events with attendee emails replaced by contact names where available
 */
async function enrichEventAttendees(
  events: CalendarEvent[],
): Promise<CalendarEvent[]> {
  const emails = [...new Set(events.flatMap((e) => e.attendees || []))];
  if (emails.length === 0) return events;

  const resolved = await withTimeout(
    contactResolver.resolveBatch(emails),
    5000,
    new Map(),
    'calendar_enrichment',
  );
  return events.map((e) => ({
    ...e,
    attendees: e.attendees?.map((a) => resolved.get(a)?.fullName || a),
  }));
}

/**
 * Formats a calendar event as a markdown list item
 */
const formatEventMarkdown = (event: {
  title: string;
  calendar?: string;
  id?: string;
  startDate?: string;
  endDate?: string;
  notes?: string;
  location?: string;
  url?: string;
  isAllDay?: boolean;
  attendees?: string[];
}): string[] => {
  const lines: string[] = [];
  lines.push(`- ${event.title}`);
  if (event.calendar) lines.push(`  - Calendar: ${event.calendar}`);
  if (event.id) lines.push(`  - ID: ${event.id}`);
  if (event.startDate) lines.push(`  - Start: ${event.startDate}`);
  if (event.endDate) lines.push(`  - End: ${event.endDate}`);
  if (event.isAllDay) lines.push(`  - All Day: ${event.isAllDay}`);
  if (event.location) lines.push(`  - Location: ${event.location}`);
  if (event.notes)
    lines.push(`  - Notes: ${formatMultilineNotes(event.notes)}`);
  if (event.url) lines.push(`  - URL: ${event.url}`);
  if (event.attendees && event.attendees.length > 0) {
    lines.push(`  - Attendees: ${event.attendees.join(', ')}`);
  }
  return lines;
};

export const handleCreateCalendarEvent = async (
  args: CalendarToolArgs,
): Promise<CallToolResult> => {
  return handleAsyncOperation(async () => {
    const validatedArgs = extractAndValidateArgs(
      args,
      CreateCalendarEventSchema,
    );
    const recurrence = validatedArgs.recurrence
      ? {
          frequency: validatedArgs.recurrence,
          interval: validatedArgs.recurrenceInterval,
          endDate: validatedArgs.recurrenceEnd,
          occurrenceCount: validatedArgs.recurrenceCount,
        }
      : undefined;
    const event = await calendarRepository.createEvent({
      title: validatedArgs.title,
      startDate: validatedArgs.startDate,
      endDate: validatedArgs.endDate,
      calendar: validatedArgs.targetCalendar,
      notes: validatedArgs.note,
      location: validatedArgs.location,
      url: validatedArgs.url,
      isAllDay: validatedArgs.isAllDay,
      recurrence,
    });
    return formatSuccessMessage('created', 'event', event.title, event.id);
  }, 'create calendar event');
};

export const handleUpdateCalendarEvent = async (
  args: CalendarToolArgs,
): Promise<CallToolResult> => {
  return handleAsyncOperation(async () => {
    const validatedArgs = extractAndValidateArgs(
      args,
      UpdateCalendarEventSchema,
    );
    const recurrence = validatedArgs.recurrence
      ? {
          frequency: validatedArgs.recurrence,
          interval: validatedArgs.recurrenceInterval,
          endDate: validatedArgs.recurrenceEnd,
          occurrenceCount: validatedArgs.recurrenceCount,
        }
      : undefined;
    const event = await calendarRepository.updateEvent({
      id: validatedArgs.id,
      title: validatedArgs.title,
      startDate: validatedArgs.startDate,
      endDate: validatedArgs.endDate,
      calendar: validatedArgs.targetCalendar,
      notes: validatedArgs.note,
      location: validatedArgs.location,
      url: validatedArgs.url,
      isAllDay: validatedArgs.isAllDay,
      recurrence,
    });
    return formatSuccessMessage('updated', 'event', event.title, event.id);
  }, 'update calendar event');
};

export const handleDeleteCalendarEvent = async (
  args: CalendarToolArgs,
): Promise<CallToolResult> => {
  return handleAsyncOperation(async () => {
    const validatedArgs = extractAndValidateArgs(
      args,
      DeleteCalendarEventSchema,
    );
    await calendarRepository.deleteEvent(validatedArgs.id);
    return formatDeleteMessage('event', validatedArgs.id, {
      useQuotes: true,
      useIdPrefix: true,
      usePeriod: true,
      useColon: false,
    });
  }, 'delete calendar event');
};

export const handleReadCalendarEvents = async (
  args: CalendarToolArgs,
): Promise<CallToolResult> => {
  return handleAsyncOperation(async () => {
    const validatedArgs = extractAndValidateArgs(
      args,
      ReadCalendarEventsSchema,
    );

    if (validatedArgs.id) {
      let event = await calendarRepository.findEventById(validatedArgs.id);
      // Enrich single event attendees if enabled (default: true)
      if (validatedArgs.enrichContacts !== false) {
        const enriched = await enrichEventAttendees([event]);
        event = enriched[0];
      }
      return formatEventMarkdown(event).join('\n');
    }

    let events = await calendarRepository.findEvents({
      startDate: validatedArgs.startDate,
      endDate: validatedArgs.endDate,
      calendarName: validatedArgs.filterCalendar,
      search: validatedArgs.search,
    });

    // Enrich attendees with contact names if enabled (default: true)
    if (validatedArgs.enrichContacts !== false) {
      events = await enrichEventAttendees(events);
    }

    return formatListMarkdown(
      'Calendar Events',
      events,
      formatEventMarkdown,
      'No calendar events found.',
      { includeTimezone: true },
    );
  }, 'read calendar events');
};

export const handleReadCalendars = async (
  args?: CalendarsToolArgs,
): Promise<CallToolResult> => {
  return handleAsyncOperation(async () => {
    extractAndValidateArgs(args, ReadCalendarsSchema);
    const calendars = await calendarRepository.findAllCalendars();
    return formatListMarkdown(
      'Calendars',
      calendars,
      (calendar) => [`- ${calendar.title} (ID: ${calendar.id})`],
      'No calendars found.',
    );
  }, 'read calendars');
};
