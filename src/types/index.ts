/**
 * types/index.ts
 * Type definitions for the Apple Reminders MCP server
 */

/**
 * Reminder item interface
 */
export interface Reminder {
  id: string;
  title: string;
  dueDate?: string;
  notes?: string;
  url?: string; // Native URL field (currently limited by EventKit API)
  list: string;
  isCompleted: boolean;
}

/**
 * Reminder list interface
 */
export interface ReminderList {
  id: string;
  title: string;
}

/**
 * Calendar event interface
 */
export interface CalendarEvent {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  calendar: string;
  notes?: string;
  location?: string;
  url?: string;
  isAllDay: boolean;
}

/**
 * Calendar interface
 */
export interface Calendar {
  id: string;
  title: string;
}

/**
 * Server configuration
 */
export interface ServerConfig {
  name: string;
  version: string;
}

/**
 * Shared type constants for better type safety and consistency
 */
export type ReminderAction = 'read' | 'create' | 'update' | 'delete';
export type ListAction = 'read' | 'create' | 'update' | 'delete';
export type CalendarAction = 'read' | 'create' | 'update' | 'delete';
export type CalendarsAction = 'read';
export type DueWithinOption =
  | 'today'
  | 'tomorrow'
  | 'this-week'
  | 'overdue'
  | 'no-date';

/**
 * Action constant arrays for enum validation
 */
export const REMINDER_ACTIONS: readonly ReminderAction[] = [
  'read',
  'create',
  'update',
  'delete',
] as const;

export const LIST_ACTIONS: readonly ListAction[] = [
  'read',
  'create',
  'update',
  'delete',
] as const;

export const CALENDAR_ACTIONS: readonly CalendarAction[] = [
  'read',
  'create',
  'update',
  'delete',
] as const;

export const DUE_WITHIN_OPTIONS: readonly DueWithinOption[] = [
  'today',
  'tomorrow',
  'this-week',
  'overdue',
  'no-date',
] as const;

/**
 * Base tool arguments interface
 */
interface BaseToolArgs {
  action: string;
}

/**
 * Tool argument types - keeping flexible for handler routing while maintaining type safety
 */
export interface RemindersToolArgs extends BaseToolArgs {
  action: ReminderAction;
  // ID parameter
  id?: string;
  // Filtering parameters (for list action)
  filterList?: string;
  showCompleted?: boolean;
  search?: string;
  dueWithin?: DueWithinOption;
  // Single item parameters
  title?: string;
  newTitle?: string;
  dueDate?: string;
  note?: string;
  url?: string;
  completed?: boolean;
  // Target list for create/update operations
  targetList?: string;
}

export interface ListsToolArgs extends BaseToolArgs {
  action: ListAction;
  name?: string;
  newName?: string;
}

export interface CalendarToolArgs extends BaseToolArgs {
  action: CalendarAction;
  // ID parameter
  id?: string;
  // Filtering parameters (for read action)
  filterCalendar?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  // Single item parameters
  title?: string;
  note?: string;
  location?: string;
  url?: string;
  isAllDay?: boolean;
  // Target calendar for create/update operations
  targetCalendar?: string;
}

export interface CalendarsToolArgs extends BaseToolArgs {
  action: CalendarsAction;
}

// --- Notes ---

export type NotesAction = 'read' | 'create' | 'update' | 'delete';

export const NOTES_ACTIONS: readonly NotesAction[] = [
  'read',
  'create',
  'update',
  'delete',
] as const;

export interface NotesToolArgs extends BaseToolArgs {
  action: NotesAction;
  id?: string;
  title?: string;
  body?: string;
  folder?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export type NotesFoldersAction = 'read' | 'create';

export const NOTES_FOLDERS_ACTIONS: readonly NotesFoldersAction[] = [
  'read',
  'create',
] as const;

export interface NotesFoldersToolArgs extends BaseToolArgs {
  action: NotesFoldersAction;
  name?: string;
}

// --- Mail ---

export type MailAction = 'read' | 'create' | 'update' | 'delete';

export const MAIL_ACTIONS: readonly MailAction[] = [
  'read',
  'create',
  'update',
  'delete',
] as const;

export interface MailToolArgs extends BaseToolArgs {
  action: MailAction;
  id?: string;
  search?: string;
  subject?: string;
  body?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  replyToId?: string;
  mailbox?: string;
  account?: string;
  read?: boolean;
  limit?: number;
  offset?: number;
}

// --- Messages ---

export type MessagesAction = 'read' | 'create';

export const MESSAGES_ACTIONS: readonly MessagesAction[] = [
  'read',
  'create',
] as const;

export interface MessagesToolArgs extends BaseToolArgs {
  action: MessagesAction;
  chatId?: string;
  search?: string;
  searchMessages?: boolean;
  to?: string;
  text?: string;
  limit?: number;
  offset?: number;
}

// --- Contacts ---

export type ContactsAction = 'read' | 'search' | 'create' | 'update';

export const CONTACTS_ACTIONS: readonly ContactsAction[] = [
  'read',
  'search',
  'create',
  'update',
] as const;

/**
 * Represents an email address with optional label
 */
export interface ContactEmail {
  value: string;
  label?: string;
}

/**
 * Represents a phone number with optional label
 */
export interface ContactPhone {
  value: string;
  label?: string;
}

/**
 * Represents a physical address
 */
export interface ContactAddress {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  label?: string;
}

/**
 * Contact interface representing a person from Contacts app
 */
export interface Contact {
  id: string;
  firstName?: string;
  lastName?: string;
  fullName: string;
  organization?: string;
  jobTitle?: string;
  emails: ContactEmail[];
  phones: ContactPhone[];
  addresses: ContactAddress[];
  note?: string;
  birthday?: string;
  modificationDate?: string;
}

export interface ContactsToolArgs extends BaseToolArgs {
  action: ContactsAction;
  id?: string;
  search?: string;
  firstName?: string;
  lastName?: string;
  organization?: string;
  jobTitle?: string;
  email?: string;
  emailLabel?: string;
  phone?: string;
  phoneLabel?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  addressLabel?: string;
  note?: string;
  limit?: number;
  offset?: number;
}

/**
 * Prompt-related type exports for consumers that need to interact with the
 * structured MCP prompt registry.
 */
export type {
  DailyTaskOrganizerArgs,
  PromptArgsByName,
  PromptArgumentDefinition,
  PromptMessage,
  PromptMessageContent,
  PromptMetadata,
  PromptName,
  PromptResponse,
  PromptTemplate,
  ReminderReviewAssistantArgs,
  SmartReminderCreatorArgs,
  WeeklyPlanningWorkflowArgs,
} from './prompts.js';
