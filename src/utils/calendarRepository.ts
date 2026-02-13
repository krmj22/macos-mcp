/**
 * calendarRepository.ts
 * Repository pattern implementation for calendar event data access operations using EventKitCLI.
 */

import type { Calendar, CalendarEvent } from '../types/index.js';
import type {
  CalendarJSON,
  CreateEventData,
  EventJSON,
  EventsReadResult,
  UpdateEventData,
} from '../types/repository.js';
import { executeCli } from './cliExecutor.js';
import {
  addOptionalArg,
  addOptionalBooleanArg,
  addOptionalNumberArg,
  nullToUndefined,
} from './helpers.js';

class CalendarRepository {
  private async readEvents(
    startDate?: string,
    endDate?: string,
    calendarName?: string,
    search?: string,
  ): Promise<EventsReadResult> {
    const args = ['--action', 'read-events'];
    addOptionalArg(args, '--startDate', startDate);
    addOptionalArg(args, '--endDate', endDate);
    addOptionalArg(args, '--filterCalendar', calendarName);
    addOptionalArg(args, '--search', search);

    return executeCli<EventsReadResult>(args);
  }

  private formatDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 00:00:00`;
  }

  private defaultStartDate(): string {
    const now = new Date();
    return this.formatDate(
      new Date(now.getFullYear() - 2, now.getMonth(), now.getDate()),
    );
  }

  private defaultEndDate(): string {
    const now = new Date();
    return this.formatDate(
      new Date(now.getFullYear() + 2, now.getMonth(), now.getDate()),
    );
  }

  async findEventById(id: string): Promise<CalendarEvent> {
    // EventKit requires bounded date range — distantPast/distantFuture returns 0 events
    const { events } = await this.readEvents(
      this.defaultStartDate(),
      this.defaultEndDate(),
    );
    const event = events.find((e) => e.id === id);
    if (!event) {
      throw new Error(`Event with ID '${id}' not found.`);
    }
    return nullToUndefined(event, [
      'notes',
      'location',
      'url',
      'attendees',
    ]) as CalendarEvent;
  }

  async findEvents(
    filters: {
      startDate?: string;
      endDate?: string;
      calendarName?: string;
      search?: string;
    } = {},
  ): Promise<CalendarEvent[]> {
    // EventKit requires bounded date range — distantPast/distantFuture returns 0 events
    const startDate = filters.startDate ?? this.defaultStartDate();
    const endDate = filters.endDate ?? this.defaultEndDate();
    const { events } = await this.readEvents(
      startDate,
      endDate,
      filters.calendarName,
      filters.search,
    );
    return events.map((e) =>
      nullToUndefined(e, ['notes', 'location', 'url', 'attendees']),
    ) as CalendarEvent[];
  }

  async findAllCalendars(): Promise<Calendar[]> {
    return executeCli<CalendarJSON[]>(['--action', 'read-calendars']);
  }

  async createEvent(data: CreateEventData): Promise<EventJSON> {
    const args = [
      '--action',
      'create-event',
      '--title',
      data.title,
      '--startDate',
      data.startDate,
      '--endDate',
      data.endDate,
    ];
    addOptionalArg(args, '--targetCalendar', data.calendar);
    addOptionalArg(args, '--note', data.notes);
    addOptionalArg(args, '--location', data.location);
    addOptionalArg(args, '--url', data.url);
    addOptionalBooleanArg(args, '--isAllDay', data.isAllDay);
    // Recurrence parameters
    if (data.recurrence) {
      addOptionalArg(args, '--recurrence', data.recurrence.frequency);
      addOptionalNumberArg(
        args,
        '--recurrenceInterval',
        data.recurrence.interval,
      );
      addOptionalArg(args, '--recurrenceEnd', data.recurrence.endDate);
      addOptionalNumberArg(
        args,
        '--recurrenceCount',
        data.recurrence.occurrenceCount,
      );
    }

    return executeCli<EventJSON>(args);
  }

  async updateEvent(data: UpdateEventData): Promise<EventJSON> {
    const args = ['--action', 'update-event', '--id', data.id];
    addOptionalArg(args, '--title', data.title);
    addOptionalArg(args, '--targetCalendar', data.calendar);
    addOptionalArg(args, '--startDate', data.startDate);
    addOptionalArg(args, '--endDate', data.endDate);
    addOptionalArg(args, '--note', data.notes);
    addOptionalArg(args, '--location', data.location);
    addOptionalArg(args, '--url', data.url);
    addOptionalBooleanArg(args, '--isAllDay', data.isAllDay);
    // Recurrence parameters
    if (data.recurrence) {
      addOptionalArg(args, '--recurrence', data.recurrence.frequency);
      addOptionalNumberArg(
        args,
        '--recurrenceInterval',
        data.recurrence.interval,
      );
      addOptionalArg(args, '--recurrenceEnd', data.recurrence.endDate);
      addOptionalNumberArg(
        args,
        '--recurrenceCount',
        data.recurrence.occurrenceCount,
      );
    }

    return executeCli<EventJSON>(args);
  }

  async deleteEvent(id: string): Promise<void> {
    await executeCli<unknown>(['--action', 'delete-event', '--id', id]);
  }
}

export const calendarRepository = new CalendarRepository();
