/**
 * tools/index.ts
 * Tool routing: normalizes names, dispatches to handlers
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
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
} from '../types/index.js';
import { MESSAGES, TOOLS as TOOL_NAMES } from '../utils/constants.js';
import { logToolError } from '../utils/logging.js';
import { TOOLS } from './definitions.js';
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

const TOOL_ALIASES: Record<string, string> = TOOL_NAMES.ALIASES;

function normalizeToolName(name: string): string {
  return TOOL_ALIASES[name] ?? name;
}

type ToolArgs =
  | RemindersToolArgs
  | ListsToolArgs
  | CalendarToolArgs
  | CalendarsToolArgs
  | NotesToolArgs
  | NotesFoldersToolArgs
  | MailToolArgs
  | MessagesToolArgs
  | ContactsToolArgs;

type ToolRouter = (args?: ToolArgs) => Promise<CallToolResult>;

type ActionHandler<TArgs extends { action: string }> = (
  args: TArgs,
) => Promise<CallToolResult>;

type RoutedToolName =
  | 'reminders_tasks'
  | 'reminders_lists'
  | 'calendar_events'
  | 'notes_items'
  | 'notes_folders'
  | 'mail_messages'
  | 'messages_chat'
  | 'contacts_people';
type ToolName = RoutedToolName | 'calendar_calendars';

/**
 * Creates an action router for tools with multiple actions
 */
const createActionRouter = <TArgs extends { action: string }>(
  toolName: RoutedToolName,
  handlerMap: Record<TArgs['action'], ActionHandler<TArgs>>,
): ToolRouter => {
  return async (args?: ToolArgs) => {
    if (!args) {
      return createErrorResponse('No arguments provided');
    }

    const typedArgs = args as TArgs;
    const action = typedArgs.action;

    if (!(action in handlerMap)) {
      return createErrorResponse(
        MESSAGES.ERROR.UNKNOWN_ACTION(toolName, String(action)),
      );
    }

    const handler = handlerMap[action as keyof typeof handlerMap];
    return handler(typedArgs);
  };
};

const TOOL_ROUTER_MAP = {
  [TOOL_NAMES.REMINDERS_TASKS]: createActionRouter<RemindersToolArgs>(
    TOOL_NAMES.REMINDERS_TASKS,
    {
      read: (reminderArgs) => handleReadReminders(reminderArgs),
      create: (reminderArgs) => handleCreateReminder(reminderArgs),
      update: (reminderArgs) => handleUpdateReminder(reminderArgs),
      delete: (reminderArgs) => handleDeleteReminder(reminderArgs),
    },
  ),
  [TOOL_NAMES.REMINDERS_LISTS]: createActionRouter<ListsToolArgs>(
    TOOL_NAMES.REMINDERS_LISTS,
    {
      read: async (_listArgs) => handleReadReminderLists(),
      create: (listArgs) => handleCreateReminderList(listArgs),
      update: (listArgs) => handleUpdateReminderList(listArgs),
      delete: (listArgs) => handleDeleteReminderList(listArgs),
    },
  ),
  [TOOL_NAMES.CALENDAR_EVENTS]: createActionRouter<CalendarToolArgs>(
    TOOL_NAMES.CALENDAR_EVENTS,
    {
      read: (calendarArgs) => handleReadCalendarEvents(calendarArgs),
      create: (calendarArgs) => handleCreateCalendarEvent(calendarArgs),
      update: (calendarArgs) => handleUpdateCalendarEvent(calendarArgs),
      delete: (calendarArgs) => handleDeleteCalendarEvent(calendarArgs),
    },
  ),
  [TOOL_NAMES.CALENDAR_CALENDARS]: async (args?: ToolArgs) => {
    return handleReadCalendars(args as CalendarsToolArgs | undefined);
  },
  [TOOL_NAMES.NOTES_ITEMS]: createActionRouter<NotesToolArgs>(
    TOOL_NAMES.NOTES_ITEMS,
    {
      read: (notesArgs) => handleReadNotes(notesArgs),
      create: (notesArgs) => handleCreateNote(notesArgs),
      update: (notesArgs) => handleUpdateNote(notesArgs),
      delete: (notesArgs) => handleDeleteNote(notesArgs),
    },
  ),
  [TOOL_NAMES.NOTES_FOLDERS]: createActionRouter<NotesFoldersToolArgs>(
    TOOL_NAMES.NOTES_FOLDERS,
    {
      read: (folderArgs) => handleReadNotesFolders(folderArgs),
      create: (folderArgs) => handleCreateNotesFolder(folderArgs),
    },
  ),
  [TOOL_NAMES.MAIL_MESSAGES]: createActionRouter<MailToolArgs>(
    TOOL_NAMES.MAIL_MESSAGES,
    {
      read: (mailArgs) => handleReadMail(mailArgs),
      create: (mailArgs) => handleCreateMail(mailArgs),
      update: (mailArgs) => handleUpdateMail(mailArgs),
      delete: (mailArgs) => handleDeleteMail(mailArgs),
    },
  ),
  [TOOL_NAMES.MESSAGES_CHAT]: createActionRouter<MessagesToolArgs>(
    TOOL_NAMES.MESSAGES_CHAT,
    {
      read: (msgArgs) => handleReadMessages(msgArgs),
      create: (msgArgs) => handleCreateMessage(msgArgs),
    },
  ),
  [TOOL_NAMES.CONTACTS_PEOPLE]: createActionRouter<ContactsToolArgs>(
    TOOL_NAMES.CONTACTS_PEOPLE,
    {
      read: (contactsArgs) => handleReadContacts(contactsArgs),
      search: (contactsArgs) => handleSearchContacts(contactsArgs),
      create: (contactsArgs) => handleCreateContact(contactsArgs),
      update: (contactsArgs) => handleUpdateContact(contactsArgs),
      delete: (contactsArgs) => handleDeleteContact(contactsArgs),
    },
  ),
} satisfies Record<ToolName, ToolRouter>;

const isManagedToolName = (value: string): value is ToolName =>
  value in TOOL_ROUTER_MAP;

/**
 * Creates an error response with the given message
 */
function createErrorResponse(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

export async function handleToolCall(
  name: string,
  args?: ToolArgs,
): Promise<CallToolResult> {
  const normalizedName = normalizeToolName(name);

  if (!isManagedToolName(normalizedName)) {
    return createErrorResponse(MESSAGES.ERROR.UNKNOWN_TOOL(name));
  }

  const router = TOOL_ROUTER_MAP[normalizedName];

  let result: CallToolResult;
  try {
    result = await router(args);
  } catch (error) {
    logToolError(normalizedName, args, error);
    throw error;
  }

  if (result.isError) {
    const errorText =
      result.content[0]?.type === 'text'
        ? (result.content[0] as { type: 'text'; text: string }).text
        : 'Unknown error';
    logToolError(normalizedName, args, errorText);
  }

  return result;
}

export { TOOLS };
