/**
 * handlers/index.ts
 * Unified exports for all tool handlers
 */

export {
  handleCreateCalendarEvent,
  handleDeleteCalendarEvent,
  handleReadCalendarEvents,
  handleReadCalendars,
  handleUpdateCalendarEvent,
} from './calendarHandlers.js';
export {
  handleCreateContact,
  handleReadContacts,
  handleSearchContacts,
  handleUpdateContact,
} from './contactsHandlers.js';
export {
  handleCreateReminderList,
  handleDeleteReminderList,
  handleReadReminderLists,
  handleUpdateReminderList,
} from './listHandlers.js';
export {
  handleCreateMail,
  handleDeleteMail,
  handleReadMail,
  handleUpdateMail,
} from './mailHandlers.js';
export {
  handleCreateMessage,
  handleReadMessages,
} from './messagesHandlers.js';
export {
  handleCreateNote,
  handleCreateNotesFolder,
  handleDeleteNote,
  handleReadNotes,
  handleReadNotesFolders,
  handleUpdateNote,
} from './notesHandlers.js';
export {
  handleCreateReminder,
  handleDeleteReminder,
  handleReadReminders,
  handleUpdateReminder,
} from './reminderHandlers.js';
