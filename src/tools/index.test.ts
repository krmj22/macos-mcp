// Use global Jest functions to avoid extra dependencies

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ListsToolArgs, RemindersToolArgs } from '../types/index.js';
import { handleToolCall } from './index.js';

// Mock logging module
jest.mock('../utils/logging.js', () => ({
  logToolCall: jest.fn(),
  logToolError: jest.fn(),
}));

import { logToolError } from '../utils/logging.js';

const mockLogToolError = logToolError as jest.MockedFunction<
  typeof logToolError
>;

// Mock all handler functions
jest.mock('./handlers/index.js', () => ({
  handleCreateReminder: jest.fn(),
  handleReadReminderLists: jest.fn(),
  handleReadReminders: jest.fn(),
  handleUpdateReminder: jest.fn(),
  handleDeleteReminder: jest.fn(),
  handleCreateReminderList: jest.fn(),
  handleUpdateReminderList: jest.fn(),
  handleDeleteReminderList: jest.fn(),
  handleCreateCalendarEvent: jest.fn(),
  handleReadCalendarEvents: jest.fn(),
  handleUpdateCalendarEvent: jest.fn(),
  handleDeleteCalendarEvent: jest.fn(),
  handleReadCalendars: jest.fn(),
  handleReadNotes: jest.fn(),
  handleCreateNote: jest.fn(),
  handleUpdateNote: jest.fn(),
  handleDeleteNote: jest.fn(),
  handleReadNotesFolders: jest.fn(),
  handleCreateNotesFolder: jest.fn(),
  handleReadMail: jest.fn(),
  handleCreateMail: jest.fn(),
  handleUpdateMail: jest.fn(),
  handleDeleteMail: jest.fn(),
  handleReadMessages: jest.fn(),
  handleCreateMessage: jest.fn(),
  handleReadContacts: jest.fn(),
  handleSearchContacts: jest.fn(),
  handleCreateContact: jest.fn(),
  handleUpdateContact: jest.fn(),
  handleDeleteContact: jest.fn(),
}));

jest.mock('./definitions.js', () => ({
  TOOLS: [
    { name: 'reminders_tasks', description: 'Reminder tasks tool' },
    { name: 'reminders_lists', description: 'Reminder lists tool' },
    { name: 'calendar_events', description: 'Calendar events tool' },
    { name: 'calendar_calendars', description: 'Calendar collections tool' },
    { name: 'notes_items', description: 'Notes items tool' },
    { name: 'notes_folders', description: 'Notes folders tool' },
    { name: 'mail_messages', description: 'Mail messages tool' },
    { name: 'messages_chat', description: 'Messages chat tool' },
    { name: 'contacts_people', description: 'Contacts people tool' },
  ],
}));

import {
  handleCreateCalendarEvent,
  handleCreateContact,
  handleCreateMail,
  handleCreateMessage,
  handleCreateNote,
  handleCreateNotesFolder,
  handleCreateReminder,
  handleCreateReminderList,
  handleDeleteCalendarEvent,
  handleDeleteContact,
  handleDeleteMail,
  handleDeleteNote,
  handleDeleteReminder,
  handleDeleteReminderList,
  handleReadCalendarEvents,
  handleReadCalendars,
  handleReadContacts,
  handleReadMail,
  handleReadMessages,
  handleReadNotes,
  handleReadNotesFolders,
  handleReadReminderLists,
  handleReadReminders,
  handleSearchContacts,
  handleUpdateCalendarEvent,
  handleUpdateContact,
  handleUpdateMail,
  handleUpdateNote,
  handleUpdateReminder,
  handleUpdateReminderList,
} from './handlers/index.js';

const mockHandleCreateReminder = handleCreateReminder as jest.MockedFunction<
  typeof handleCreateReminder
>;
const mockHandleReadReminders = handleReadReminders as jest.MockedFunction<
  typeof handleReadReminders
>;
const mockHandleUpdateReminder = handleUpdateReminder as jest.MockedFunction<
  typeof handleUpdateReminder
>;
const mockHandleDeleteReminder = handleDeleteReminder as jest.MockedFunction<
  typeof handleDeleteReminder
>;
const mockHandleReadReminderLists =
  handleReadReminderLists as jest.MockedFunction<
    typeof handleReadReminderLists
  >;
const mockHandleCreateReminderList =
  handleCreateReminderList as jest.MockedFunction<
    typeof handleCreateReminderList
  >;
const mockHandleUpdateReminderList =
  handleUpdateReminderList as jest.MockedFunction<
    typeof handleUpdateReminderList
  >;
const mockHandleDeleteReminderList =
  handleDeleteReminderList as jest.MockedFunction<
    typeof handleDeleteReminderList
  >;
const mockHandleCreateCalendarEvent =
  handleCreateCalendarEvent as jest.MockedFunction<
    typeof handleCreateCalendarEvent
  >;
const mockHandleReadCalendarEvents =
  handleReadCalendarEvents as jest.MockedFunction<
    typeof handleReadCalendarEvents
  >;
const mockHandleUpdateCalendarEvent =
  handleUpdateCalendarEvent as jest.MockedFunction<
    typeof handleUpdateCalendarEvent
  >;
const mockHandleDeleteCalendarEvent =
  handleDeleteCalendarEvent as jest.MockedFunction<
    typeof handleDeleteCalendarEvent
  >;
const mockHandleReadCalendars = handleReadCalendars as jest.MockedFunction<
  typeof handleReadCalendars
>;
const mockHandleReadNotes = handleReadNotes as jest.MockedFunction<
  typeof handleReadNotes
>;
const mockHandleCreateNote = handleCreateNote as jest.MockedFunction<
  typeof handleCreateNote
>;
const mockHandleUpdateNote = handleUpdateNote as jest.MockedFunction<
  typeof handleUpdateNote
>;
const mockHandleDeleteNote = handleDeleteNote as jest.MockedFunction<
  typeof handleDeleteNote
>;
const mockHandleReadNotesFolders =
  handleReadNotesFolders as jest.MockedFunction<typeof handleReadNotesFolders>;
const mockHandleCreateNotesFolder =
  handleCreateNotesFolder as jest.MockedFunction<
    typeof handleCreateNotesFolder
  >;
const mockHandleReadMail = handleReadMail as jest.MockedFunction<
  typeof handleReadMail
>;
const mockHandleCreateMail = handleCreateMail as jest.MockedFunction<
  typeof handleCreateMail
>;
const mockHandleUpdateMail = handleUpdateMail as jest.MockedFunction<
  typeof handleUpdateMail
>;
const mockHandleDeleteMail = handleDeleteMail as jest.MockedFunction<
  typeof handleDeleteMail
>;
const mockHandleReadMessages = handleReadMessages as jest.MockedFunction<
  typeof handleReadMessages
>;
const mockHandleCreateMessage = handleCreateMessage as jest.MockedFunction<
  typeof handleCreateMessage
>;
const mockHandleReadContacts = handleReadContacts as jest.MockedFunction<
  typeof handleReadContacts
>;
const mockHandleSearchContacts = handleSearchContacts as jest.MockedFunction<
  typeof handleSearchContacts
>;
const mockHandleCreateContact = handleCreateContact as jest.MockedFunction<
  typeof handleCreateContact
>;
const mockHandleUpdateContact = handleUpdateContact as jest.MockedFunction<
  typeof handleUpdateContact
>;
const mockHandleDeleteContact = handleDeleteContact as jest.MockedFunction<
  typeof handleDeleteContact
>;

describe('Tools Index', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('handleToolCall', () => {
    describe('tool routing smoke tests', () => {
      it.each([
        [
          'reminders_tasks',
          'read',
          mockHandleReadReminders,
          { action: 'read' as const },
        ],
        [
          'reminders_tasks',
          'create',
          mockHandleCreateReminder,
          { action: 'create' as const, title: 'Test' },
        ],
        [
          'reminders_tasks',
          'update',
          mockHandleUpdateReminder,
          { action: 'update' as const, title: 'Old', newTitle: 'New' },
        ],
        [
          'reminders_tasks',
          'delete',
          mockHandleDeleteReminder,
          { action: 'delete' as const, title: 'Del' },
        ],
        [
          'reminders_lists',
          'create',
          mockHandleCreateReminderList,
          { action: 'create' as const, name: 'Work' },
        ],
        [
          'reminders_lists',
          'update',
          mockHandleUpdateReminderList,
          { action: 'update' as const, name: 'Old', newName: 'New' },
        ],
        [
          'reminders_lists',
          'delete',
          mockHandleDeleteReminderList,
          { action: 'delete' as const, name: 'Del' },
        ],
        [
          'calendar_events',
          'read',
          mockHandleReadCalendarEvents,
          { action: 'read' as const },
        ],
        [
          'calendar_events',
          'create',
          mockHandleCreateCalendarEvent,
          {
            action: 'create' as const,
            title: 'Evt',
            startDate: '2025-11-04 14:00:00',
            endDate: '2025-11-04 16:00:00',
          },
        ],
        [
          'calendar_events',
          'update',
          mockHandleUpdateCalendarEvent,
          {
            action: 'update' as const,
            id: 'evt-123',
            title: 'Updated Event',
          },
        ],
        [
          'calendar_events',
          'delete',
          mockHandleDeleteCalendarEvent,
          { action: 'delete' as const, id: 'evt-123' },
        ],
        [
          'notes_items',
          'read',
          mockHandleReadNotes,
          { action: 'read' as const },
        ],
        [
          'notes_items',
          'create',
          mockHandleCreateNote,
          { action: 'create' as const, title: 'Test', body: 'Content' },
        ],
        [
          'notes_items',
          'update',
          mockHandleUpdateNote,
          { action: 'update' as const, id: 'n1', title: 'New' },
        ],
        [
          'notes_items',
          'delete',
          mockHandleDeleteNote,
          { action: 'delete' as const, id: 'n1' },
        ],
        [
          'notes_folders',
          'read',
          mockHandleReadNotesFolders,
          { action: 'read' as const },
        ],
        [
          'notes_folders',
          'create',
          mockHandleCreateNotesFolder,
          { action: 'create' as const, name: 'Work' },
        ],
        [
          'mail_messages',
          'read',
          mockHandleReadMail,
          { action: 'read' as const },
        ],
        [
          'mail_messages',
          'create',
          mockHandleCreateMail,
          {
            action: 'create' as const,
            subject: 'Test',
            body: 'Body',
            to: ['a@b.com'],
          },
        ],
        [
          'mail_messages',
          'update',
          mockHandleUpdateMail,
          { action: 'update' as const, id: 'm1', read: true },
        ],
        [
          'mail_messages',
          'delete',
          mockHandleDeleteMail,
          { action: 'delete' as const, id: 'm1' },
        ],
        [
          'messages_chat',
          'read',
          mockHandleReadMessages,
          { action: 'read' as const },
        ],
        [
          'messages_chat',
          'create',
          mockHandleCreateMessage,
          { action: 'create' as const, chatId: 'c1', text: 'Hi' },
        ],
        [
          'contacts_people',
          'read',
          mockHandleReadContacts,
          { action: 'read' as const },
        ],
        [
          'contacts_people',
          'search',
          mockHandleSearchContacts,
          { action: 'search' as const, search: 'John' },
        ],
        [
          'contacts_people',
          'create',
          mockHandleCreateContact,
          { action: 'create' as const, firstName: 'John' },
        ],
        [
          'contacts_people',
          'update',
          mockHandleUpdateContact,
          { action: 'update' as const, id: 'c1', firstName: 'Jane' },
        ],
        [
          'contacts_people',
          'delete',
          mockHandleDeleteContact,
          { action: 'delete' as const, id: 'c1' },
        ],
      ])('routes %s action=%s to correct handler', async (tool, _action, mockHandler, args) => {
        const expectedResult: CallToolResult = {
          content: [{ type: 'text', text: 'Success' }],
          isError: false,
        };
        mockHandler.mockResolvedValue(expectedResult);

        const result = await handleToolCall(tool, args);

        expect(mockHandler).toHaveBeenCalledWith(args);
        expect(result).toEqual(expectedResult);
      });
    });

    it('routes reminders_lists read (no-arg handler)', async () => {
      const expectedResult: CallToolResult = {
        content: [{ type: 'text', text: 'Lists' }],
        isError: false,
      };
      mockHandleReadReminderLists.mockResolvedValue(expectedResult);

      const result = await handleToolCall('reminders_lists', {
        action: 'read',
      });

      expect(mockHandleReadReminderLists).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expectedResult);
    });

    describe('legacy tool alias routing', () => {
      it('should route dot-notation aliases to underscore handlers', async () => {
        const args = { action: 'read' as const, id: 'legacy-id' };
        const expectedResult: CallToolResult = {
          content: [{ type: 'text', text: 'Aliased read' }],
          isError: false,
        };

        mockHandleReadReminders.mockResolvedValue(expectedResult);

        const result = await handleToolCall('reminders.tasks', args);

        expect(mockHandleReadReminders).toHaveBeenCalledWith(args);
        expect(result).toEqual(expectedResult);
      });

      it('should route notes.items alias to notes_items handler', async () => {
        mockHandleReadNotes.mockResolvedValue({
          content: [{ type: 'text', text: 'OK' }],
          isError: false,
        });
        const result = await handleToolCall('notes.items', {
          action: 'read' as const,
        });
        expect(mockHandleReadNotes).toHaveBeenCalled();
        expect(result.isError).toBe(false);
      });

      it('should route mail.messages alias to mail_messages handler', async () => {
        mockHandleReadMail.mockResolvedValue({
          content: [{ type: 'text', text: 'OK' }],
          isError: false,
        });
        const result = await handleToolCall('mail.messages', {
          action: 'read' as const,
        });
        expect(mockHandleReadMail).toHaveBeenCalled();
        expect(result.isError).toBe(false);
      });

      it('should route messages.chat alias to messages_chat handler', async () => {
        mockHandleReadMessages.mockResolvedValue({
          content: [{ type: 'text', text: 'OK' }],
          isError: false,
        });
        const result = await handleToolCall('messages.chat', {
          action: 'read' as const,
        });
        expect(mockHandleReadMessages).toHaveBeenCalled();
        expect(result.isError).toBe(false);
      });

      it('should route contacts.people alias to contacts_people handler', async () => {
        mockHandleReadContacts.mockResolvedValue({
          content: [{ type: 'text', text: 'OK' }],
          isError: false,
        });
        const result = await handleToolCall('contacts.people', {
          action: 'read' as const,
        });
        expect(mockHandleReadContacts).toHaveBeenCalled();
        expect(result.isError).toBe(false);
      });

      it('should route notes.folders alias to notes_folders handler', async () => {
        mockHandleReadNotesFolders.mockResolvedValue({
          content: [{ type: 'text', text: 'OK' }],
          isError: false,
        });
        const result = await handleToolCall('notes.folders', {
          action: 'read' as const,
        });
        expect(mockHandleReadNotesFolders).toHaveBeenCalled();
        expect(result.isError).toBe(false);
      });
    });

    describe('calendar_calendars tool routing', () => {
      it('should route read action to handleReadCalendars', async () => {
        const expectedResult: CallToolResult = {
          content: [{ type: 'text', text: 'Calendars listed' }],
          isError: false,
        };

        mockHandleReadCalendars.mockResolvedValue(expectedResult);

        const result = await handleToolCall('calendar_calendars', {
          action: 'read',
        });

        expect(mockHandleReadCalendars).toHaveBeenCalledWith({
          action: 'read',
        });
        expect(result).toEqual(expectedResult);
      });

      it('should allow missing args and still call handleReadCalendars', async () => {
        const expectedResult: CallToolResult = {
          content: [{ type: 'text', text: 'Calendars listed' }],
          isError: false,
        };

        mockHandleReadCalendars.mockResolvedValue(expectedResult);

        const result = await handleToolCall('calendar_calendars');

        expect(mockHandleReadCalendars).toHaveBeenCalledWith(undefined);
        expect(result).toEqual(expectedResult);
      });
    });

    describe('error handling', () => {
      it('should return error for unknown tool', async () => {
        const result = await handleToolCall('unknown_tool', {
          action: 'read',
        } as unknown as RemindersToolArgs);

        expect(result).toEqual({
          content: [{ type: 'text', text: 'Unknown tool: unknown_tool' }],
          isError: true,
        });
      });

      it('should return error for empty tool name', async () => {
        const result = await handleToolCall('', {
          action: 'read',
        } as RemindersToolArgs);

        expect(result).toEqual({
          content: [{ type: 'text', text: 'Unknown tool: ' }],
          isError: true,
        });
      });

      it.each([
        ['reminders_tasks', undefined, 'No arguments provided'],
        [
          'reminders_tasks',
          { action: 'unknown' },
          'Unknown reminders_tasks action: unknown',
        ],
        [
          'reminders_lists',
          { action: 'unknown' },
          'Unknown reminders_lists action: unknown',
        ],
        [
          'calendar_events',
          { action: 'unknown' },
          'Unknown calendar_events action: unknown',
        ],
        ['calendar_events', undefined, 'No arguments provided'],
        [
          'notes_items',
          { action: 'unknown' },
          'Unknown notes_items action: unknown',
        ],
        [
          'notes_folders',
          { action: 'unknown' },
          'Unknown notes_folders action: unknown',
        ],
        [
          'mail_messages',
          { action: 'unknown' },
          'Unknown mail_messages action: unknown',
        ],
        [
          'messages_chat',
          { action: 'unknown' },
          'Unknown messages_chat action: unknown',
        ],
        [
          'contacts_people',
          { action: 'unknown' },
          'Unknown contacts_people action: unknown',
        ],
      ])('returns error for %s with invalid args: %j', async (tool, args, expectedText) => {
        const result = await handleToolCall(
          tool,
          args as unknown as RemindersToolArgs,
        );
        expect(result).toEqual({
          content: [{ type: 'text', text: expectedText }],
          isError: true,
        });
      });

      it('should propagate handler errors', async () => {
        const error = new Error('Handler failed');
        mockHandleCreateReminder.mockRejectedValue(error);

        await expect(
          handleToolCall('reminders_tasks', { action: 'create' as const }),
        ).rejects.toThrow('Handler failed');
      });

      it('should log thrown errors to stderr with tool name and args', async () => {
        const error = new Error('JXA timeout');
        mockHandleCreateReminder.mockRejectedValue(error);
        const args = { action: 'create' as const, title: 'Test' };

        await expect(handleToolCall('reminders_tasks', args)).rejects.toThrow(
          'JXA timeout',
        );

        expect(mockLogToolError).toHaveBeenCalledWith(
          'reminders_tasks',
          args,
          error,
        );
      });

      it('should log isError results to stderr', async () => {
        const errorResult: CallToolResult = {
          content: [
            {
              type: 'text',
              text: 'Failed to read reminders: System error occurred',
            },
          ],
          isError: true,
        };
        mockHandleReadReminders.mockResolvedValue(errorResult);

        const args = { action: 'read' as const, id: '123' };
        const result = await handleToolCall('reminders_tasks', args);

        expect(result).toEqual(errorResult);
        expect(mockLogToolError).toHaveBeenCalledWith(
          'reminders_tasks',
          args,
          'Failed to read reminders: System error occurred',
        );
      });

      it('should not log successful tool results', async () => {
        const successResult: CallToolResult = {
          content: [{ type: 'text', text: 'Success' }],
          isError: false,
        };
        mockHandleReadReminders.mockResolvedValue(successResult);

        await handleToolCall('reminders_tasks', { action: 'read' as const });

        expect(mockLogToolError).not.toHaveBeenCalled();
      });
    });

    describe('reminders_lists validation errors', () => {
      it.each([
        ['create', { action: 'create' as const }, 'name'],
        [
          'update missing name',
          { action: 'update' as const, newName: 'New' },
          'name',
        ],
        [
          'update missing newName',
          { action: 'update' as const, name: 'Old' },
          'newName',
        ],
        ['delete', { action: 'delete' as const }, 'name'],
      ])('returns validation error for %s', async (_desc, args, missingField) => {
        // Import the actual handlers to get their validation behavior
        const {
          handleCreateReminderList,
          handleUpdateReminderList,
          handleDeleteReminderList,
        } = jest.requireMock('./handlers/index.js');
        const mockHandler =
          args.action === 'create'
            ? handleCreateReminderList
            : args.action === 'update'
              ? handleUpdateReminderList
              : handleDeleteReminderList;

        mockHandler.mockResolvedValue({
          content: [
            {
              type: 'text',
              text: `Input validation failed: ${missingField}: List name cannot be empty`,
            },
          ],
          isError: true,
        });

        const result = await handleToolCall(
          'reminders_lists',
          args as ListsToolArgs,
        );

        expect(result.isError).toBe(true);
        const textContent = result.content[0] as { type: 'text'; text: string };
        expect(textContent.text).toContain('Input validation failed');
        expect(textContent.text).toContain(missingField);
      });
    });
  });
});
