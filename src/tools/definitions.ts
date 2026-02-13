/**
 * tools/definitions.ts
 * MCP tool definitions for Apple Reminders server, adhering to standard JSON Schema.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  CALENDAR_ACTIONS,
  CONTACTS_ACTIONS,
  DATE_RANGE_SHORTCUTS,
  DUE_WITHIN_OPTIONS,
  LIST_ACTIONS,
  MAIL_ACTIONS,
  MESSAGES_ACTIONS,
  NOTES_ACTIONS,
  NOTES_FOLDERS_ACTIONS,
  REMINDER_ACTIONS,
} from '../types/index.js';

/**
 * Extended JSON Schema with dependentSchemas support
 * This extends the base schema type to include the JSON Schema Draft 2019-09 dependentSchemas keyword
 */
interface ExtendedJSONSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  dependentSchemas?: Record<string, unknown>;
  enum?: unknown[];
  description?: string;
  default?: unknown;
  format?: string;
}

/**
 * Extended Tool type that supports dependentSchemas in inputSchema
 */
interface ExtendedTool {
  name: string;
  description?: string;
  inputSchema: ExtendedJSONSchema;
}

const _EXTENDED_TOOLS: ExtendedTool[] = [
  {
    name: 'reminders_tasks',
    description:
      'Manages Apple Reminders tasks. Common actions: (1) "Show my reminders" → read action. (2) "Remind me to X" → create with title and optional dueDate. (3) "Mark X as done" → update with completed=true. Filter by list with filterList, by due date with dueWithin (today/tomorrow/this-week/overdue/no-date), or search by title/notes with search. Use targetList to assign a reminder to a specific list. Title max 200 chars, notes max 2000 chars.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: REMINDER_ACTIONS,
          description: 'The operation to perform.',
        },
        // ID-based operations
        id: {
          type: 'string',
          description:
            'The unique identifier of the reminder (REQUIRED for update, delete; optional for read to get single reminder).',
        },
        // Creation/Update properties
        title: {
          type: 'string',
          description:
            'The title of the reminder (REQUIRED for create, optional for update).',
        },
        dueDate: {
          type: 'string',
          description:
            "Due date. RECOMMENDED format: 'YYYY-MM-DD HH:mm:ss' (local time without timezone, e.g., '2025-11-04 18:00:00'). Also supports: 'YYYY-MM-DD', 'YYYY-MM-DDTHH:mm:ss', or ISO 8601 with timezone (e.g., '2025-10-30T04:00:00Z'). When no timezone is specified, the time is interpreted as local time.",
        },
        note: {
          type: 'string',
          description: 'Additional notes for the reminder.',
        },
        url: {
          type: 'string',
          description: 'A URL to associate with the reminder.',
          format: 'uri',
        },
        completed: {
          type: 'boolean',
          description: 'The completion status of the reminder (for update).',
        },
        targetList: {
          type: 'string',
          description: 'The name of the list for create or update operations.',
        },
        // Read filters
        filterList: {
          type: 'string',
          description: 'Filter reminders by a specific list name.',
        },
        showCompleted: {
          type: 'boolean',
          description: 'Include completed reminders in the results.',
          default: false,
        },
        search: {
          type: 'string',
          description: 'A search term to filter reminders by title or notes.',
        },
        dueWithin: {
          type: 'string',
          enum: DUE_WITHIN_OPTIONS,
          description: 'Filter reminders by a due date range.',
        },
      },
      required: ['action'],
      dependentSchemas: {
        action: {
          oneOf: [
            { properties: { action: { const: 'read' } } },
            {
              properties: { action: { const: 'create' } },
              required: ['title'],
            },
            { properties: { action: { const: 'update' } }, required: ['id'] },
            { properties: { action: { const: 'delete' } }, required: ['id'] },
          ],
        },
      },
    },
  },
  {
    name: 'reminders_lists',
    description:
      'Manages Apple Reminders lists (categories/groups that contain tasks). Common actions: (1) "What lists do I have?" → read action. (2) "Create a Shopping list" → create with name. (3) "Rename list X to Y" → update with name (current) and newName. (4) "Delete list X" → delete with name. List name max 100 chars.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: LIST_ACTIONS,
          description: 'The operation to perform on a list.',
        },
        name: {
          type: 'string',
          description:
            'The current name of the list (for update, delete) or the name of the new list (for create).',
        },
        newName: {
          type: 'string',
          description: 'The new name for the list (for update).',
        },
      },
      required: ['action'],
      dependentSchemas: {
        action: {
          oneOf: [
            { properties: { action: { const: 'read' } } },
            { properties: { action: { const: 'create' } }, required: ['name'] },
            {
              properties: { action: { const: 'update' } },
              required: ['name', 'newName'],
            },
            { properties: { action: { const: 'delete' } }, required: ['name'] },
          ],
        },
      },
    },
  },
  {
    name: 'calendar_events',
    description:
      'Manages Apple Calendar events. Common actions: (1) "What\'s on my calendar?" → read with startDate/endDate range. (2) "Schedule a meeting" → create with title, startDate, endDate. (3) "Move my meeting" → update with id and new startDate/endDate. Supports recurring events via recurrence param (daily/weekly/monthly/yearly). Use filterCalendar to filter by calendar name, search to find events by title/notes/location. Use enrichContacts=true (default) to resolve attendee emails to contact names. Deleting a recurring event only removes the single occurrence. Use calendar_calendars tool first to see available calendar names. Related tools: Cross-reference with messages_chat or mail_messages to find conversations about a specific event. Use contacts_people for attendee contact details.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: CALENDAR_ACTIONS,
          description: 'The operation to perform.',
        },
        // ID-based operations
        id: {
          type: 'string',
          description:
            'The unique identifier of the event (REQUIRED for update, delete; optional for read to get single event).',
        },
        // Creation/Update properties
        title: {
          type: 'string',
          description:
            'The title of the event (REQUIRED for create, optional for update).',
        },
        startDate: {
          type: 'string',
          description:
            "Start date and time. RECOMMENDED format: 'YYYY-MM-DD HH:mm:ss' (local time without timezone, e.g., '2025-11-04 09:00:00'). Also supports: 'YYYY-MM-DD', 'YYYY-MM-DDTHH:mm:ss', or ISO 8601 with timezone (e.g., '2025-11-04T09:00:00-05:00'). When no timezone offset is specified, the time is interpreted in the macOS system timezone. Use explicit timezone offsets (e.g., '-05:00', '+09:00', 'Z') for cross-timezone clarity.",
        },
        endDate: {
          type: 'string',
          description:
            "End date and time. RECOMMENDED format: 'YYYY-MM-DD HH:mm:ss' (local time without timezone, e.g., '2025-11-04 10:00:00'). Also supports: 'YYYY-MM-DD', 'YYYY-MM-DDTHH:mm:ss', or ISO 8601 with timezone (e.g., '2025-11-04T10:00:00-05:00'). When no timezone offset is specified, the time is interpreted in the macOS system timezone. Use explicit timezone offsets (e.g., '-05:00', '+09:00', 'Z') for cross-timezone clarity.",
        },
        note: {
          type: 'string',
          description: 'Additional notes for the event.',
        },
        location: {
          type: 'string',
          description: 'Location for the event.',
        },
        url: {
          type: 'string',
          description: 'A URL to associate with the event.',
          format: 'uri',
        },
        isAllDay: {
          type: 'boolean',
          description: 'Whether the event is an all-day event.',
        },
        targetCalendar: {
          type: 'string',
          description:
            'The name of the calendar for create or update operations.',
        },
        // Recurrence properties
        recurrence: {
          type: 'string',
          enum: ['daily', 'weekly', 'monthly', 'yearly'],
          description:
            'Recurrence frequency for the event (for create/update).',
        },
        recurrenceInterval: {
          type: 'number',
          description:
            'How often the event recurs (e.g., 2 = every 2 days/weeks/months/years). Default: 1.',
        },
        recurrenceEnd: {
          type: 'string',
          description:
            "End date for recurrence in 'YYYY-MM-DD' format. Specify either recurrenceEnd or recurrenceCount, not both.",
        },
        recurrenceCount: {
          type: 'number',
          description:
            'Number of occurrences for the recurrence. Specify either recurrenceEnd or recurrenceCount, not both.',
        },
        // Read filters
        filterCalendar: {
          type: 'string',
          description: 'Filter events by a specific calendar name.',
        },
        search: {
          type: 'string',
          description:
            'A search term to filter events by title, notes, or location.',
        },
        enrichContacts: {
          type: 'boolean',
          description:
            'Resolve attendee email addresses to contact names (default true). Set to false to show raw email addresses.',
          default: true,
        },
      },
      required: ['action'],
      dependentSchemas: {
        action: {
          oneOf: [
            { properties: { action: { const: 'read' } } },
            {
              properties: { action: { const: 'create' } },
              required: ['title', 'startDate', 'endDate'],
            },
            { properties: { action: { const: 'update' } }, required: ['id'] },
            { properties: { action: { const: 'delete' } }, required: ['id'] },
          ],
        },
      },
    },
  },
  {
    name: 'calendar_calendars',
    description:
      'Lists all available Apple Calendar collections (e.g., "Work", "Personal", "Birthdays"). Read-only. Use this to discover calendar names before creating or filtering events with the calendar_events tool. Only supports the read action.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['read'],
          description: 'The operation to perform on calendars.',
        },
      },
      required: ['action'],
      dependentSchemas: {
        action: {
          oneOf: [{ properties: { action: { const: 'read' } } }],
        },
      },
    },
  },
  {
    name: 'notes_items',
    description:
      'Manages Apple Notes. IMPORTANT: Apple Notes uses plain text, NOT markdown — do not send markdown formatting (no **, ##, -, etc.). Title max 200 chars, body max 2000 chars (total after append). Common actions: (1) "Find my note about X" → read with search param (searches title and body). (2) "Create a note" → create with title and body (plain text only). (3) "Move note to folder X" → update with id and targetFolder param. (4) "Edit my note" → update with id, and new title/body. (5) "Add to my note" → update with id, body, and append=true (appends body to existing content without needing to read first). To append to a note by name, this is a 2-call workflow (there is no way to update by name directly): first search with { action: "read", search: "note name" } to get the note ID, then update with { action: "update", id: "...", body: "new content", append: true }. Delete moves notes to Recently Deleted. Use folder param on read to filter by folder, or on create to place in a specific folder (defaults to "Notes"). Note: updating body (with or without append) replaces rich text formatting with plain text. Title quirk: Apple Notes derives the displayed title from the first paragraph of the body — after an append, the title shown in the Notes app may change even though the name property was not modified. The name returned by this tool is the original explicit title, which is correct. Paginated: use limit (default 50, max 200) and offset.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: NOTES_ACTIONS,
          description: 'The operation to perform.',
        },
        id: {
          type: 'string',
          description:
            'The unique identifier of the note (REQUIRED for update, delete; optional for read to get single note).',
        },
        title: {
          type: 'string',
          description:
            'The title of the note (REQUIRED for create, max 200 chars).',
        },
        body: {
          type: 'string',
          description:
            'The body content of the note (plain text only, max 2000 chars). Do NOT use markdown formatting — Apple Notes does not render it.',
        },
        folder: {
          type: 'string',
          description:
            'The folder name — for create (defaults to Notes) or for read to filter by folder.',
        },
        targetFolder: {
          type: 'string',
          description:
            'Move the note to this folder (for update action). This is how you move notes between folders — use update with id and targetFolder. Can be combined with title/body changes in the same update call.',
        },
        append: {
          type: 'boolean',
          description:
            'When true, appends body content to the existing note instead of replacing it (for update action). Eliminates the need for a read-then-update round trip. The 2000 char limit applies to the final combined length. Note: appending converts existing rich text formatting to plain text.',
        },
        search: {
          type: 'string',
          description: 'A search term to filter notes by title or content.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of items to return (1-200, default 50).',
          default: 50,
        },
        offset: {
          type: 'number',
          description: 'Number of items to skip for pagination (default 0).',
          default: 0,
        },
      },
      required: ['action'],
      dependentSchemas: {
        action: {
          oneOf: [
            { properties: { action: { const: 'read' } } },
            {
              properties: { action: { const: 'create' } },
              required: ['title'],
            },
            { properties: { action: { const: 'update' } }, required: ['id'] },
            { properties: { action: { const: 'delete' } }, required: ['id'] },
          ],
        },
      },
    },
  },
  {
    name: 'notes_folders',
    description:
      'Manages Apple Notes folders. Only read and create are supported — folder renaming and deletion are NOT available through the Apple Notes API. Common actions: (1) "What folders do I have?" → read action (returns folder names and note counts). (2) "Create a folder called X" → create with name. To move a note between folders, use the notes_items tool with update action and targetFolder param. Folder name max 100 chars.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: NOTES_FOLDERS_ACTIONS,
          description: 'The operation to perform.',
        },
        name: {
          type: 'string',
          description:
            'The name of the folder to create (REQUIRED for create).',
        },
      },
      required: ['action'],
      dependentSchemas: {
        action: {
          oneOf: [
            { properties: { action: { const: 'read' } } },
            {
              properties: { action: { const: 'create' } },
              required: ['name'],
            },
          ],
        },
      },
    },
  },
  {
    name: 'mail_messages',
    description:
      'Manages Apple Mail. IMPORTANT: The create action creates a DRAFT in Mail, it does NOT send the email — the user must open Mail and click Send. To find emails from a person, use the contact parameter with their name — you do NOT need to look up their email address first. The contact param resolves names to email addresses automatically and searches across all mailboxes. This is the recommended approach for any person-based email lookup. Common actions: (1) "Show emails from John" → read with contact="John" (resolves name to emails automatically, no contacts lookup needed). (2) "Draft an email to John" → first read with contact="John" to get their email address from results, then create with to=[email]. (3) "Search for emails about X" → read with search param (searches subject, sender, and body). (4) "Read my inbox" → read action with no filters. (5) "Draft a reply" → create with replyToId (auto-populates subject, recipients, and quoted body). (6) "List mailboxes" → read with mailbox="_list". Use enrichContacts=true (default) to show sender names instead of raw email addresses. Paginated: use limit (default 50, max 200) and offset. Subject max 200 chars, body max 10000 chars. Related tools: Combine with calendar_events to find emails about upcoming events. Use contacts_people for full contact details, though the contact param here handles name-to-email resolution automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: MAIL_ACTIONS,
          description: 'The operation to perform.',
        },
        id: {
          type: 'string',
          description:
            'The unique identifier of the mail message (REQUIRED for update, delete; optional for read).',
        },
        search: {
          type: 'string',
          description:
            'A search term to filter messages by subject, sender, or body content.',
        },
        contact: {
          type: 'string',
          description:
            'Find emails from a contact by name (partial match, case-insensitive). Looks up all email addresses for the contact and returns matching messages across all mailboxes. This is the easiest way to find emails from a specific person.',
        },
        enrichContacts: {
          type: 'boolean',
          description:
            'Resolve sender email addresses to contact names (default true). Set to false to show raw email addresses.',
          default: true,
        },
        mailbox: {
          type: 'string',
          description:
            'Mailbox name to read from. Use "_list" to list all mailboxes.',
        },
        account: {
          type: 'string',
          description: 'Account name to scope mailbox reads (optional).',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of items to return (1-200, default 50).',
          default: 50,
        },
        offset: {
          type: 'number',
          description: 'Number of items to skip for pagination (default 0).',
          default: 0,
        },
        subject: {
          type: 'string',
          description: 'The subject of the email (REQUIRED for create).',
        },
        body: {
          type: 'string',
          description: 'The body content of the email (REQUIRED for create).',
        },
        to: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Array of recipient email addresses (REQUIRED for create).',
        },
        cc: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of CC recipient email addresses.',
        },
        bcc: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of BCC recipient email addresses.',
        },
        replyToId: {
          type: 'string',
          description:
            'ID of the message to reply to. Creates a draft reply with auto-populated "Re:" subject prefix, quoted original body, and pre-filled recipients (to/cc from the original message). When replyToId is provided, subject, body, and to become optional — they will be auto-populated from the original message if omitted.',
        },
        read: {
          type: 'boolean',
          description:
            'Mark message as read (true) or unread (false). For update action.',
        },
      },
      required: ['action'],
      dependentSchemas: {
        action: {
          oneOf: [
            { properties: { action: { const: 'read' } } },
            {
              properties: { action: { const: 'create' } },
              required: ['subject', 'body', 'to'],
            },
            {
              properties: { action: { const: 'update' } },
              required: ['id', 'read'],
            },
            { properties: { action: { const: 'delete' } }, required: ['id'] },
          ],
        },
      },
    },
  },
  {
    name: 'messages_chat',
    description:
      'Manages Apple Messages (iMessage/SMS). Only read and create are supported — message deletion and editing are NOT available through the Apple Messages API. Common actions: (1) "Show messages from John" → read with contact param (looks up contact by name, finds all their phone numbers, and returns matching messages — this is the EASIEST way to find messages from a person, no need to look up phone numbers first). (2) "Search messages for keyword" → read with search param AND searchMessages=true (without searchMessages, search only matches chat names/participants, not message content). (3) "List my chats" → read with no params (returns chats sorted by most recent, with last message preview). (4) "Read chat history" → read with chatId (returns messages newest-first). (5) "Send a message" → create with text and either to (phone/email) or chatId. (6) "Show today\'s messages" → read with dateRange="today" (shortcuts: today, yesterday, this_week, last_7_days, last_30_days). (7) "Show messages from a specific range" → read with startDate/endDate for custom date ranges. If both dateRange and startDate/endDate are provided, explicit startDate/endDate take precedence. Use enrichContacts=true (default) to show contact names instead of raw phone numbers. Paginated: use limit (default 50, max 200) and offset. Related tools: Combine with calendar_events to cross-reference conversations with scheduled events. Use contacts_people for full contact details, though the contact param here handles name-to-phone resolution automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: MESSAGES_ACTIONS,
          description: 'The operation to perform.',
        },
        chatId: {
          type: 'string',
          description: 'The chat ID to read messages from or send to.',
        },
        search: {
          type: 'string',
          description:
            'Search term to find chats by participant/name, or messages by content (when searchMessages is true).',
        },
        searchMessages: {
          type: 'boolean',
          description:
            'IMPORTANT: Must be set to true when you want to search message content/text. Without this flag, search only matches chat names and participant handles. Set searchMessages=true together with search to find messages containing specific words or phrases.',
        },
        contact: {
          type: 'string',
          description:
            'Find messages from a contact by name (partial match, case-insensitive). Looks up all phone numbers for the contact and returns matching messages. This is the EASIEST way to find messages from a person — no need to look up phone numbers separately.',
        },
        enrichContacts: {
          type: 'boolean',
          description:
            'Resolve phone numbers to contact names in results (default true). Set to false to show raw phone numbers.',
          default: true,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of items to return (1-200, default 50).',
          default: 50,
        },
        offset: {
          type: 'number',
          description: 'Number of items to skip for pagination (default 0).',
          default: 0,
        },
        to: {
          type: 'string',
          description:
            'The phone number or email to send an iMessage to (for create).',
        },
        text: {
          type: 'string',
          description: 'The message text to send (REQUIRED for create).',
        },
        dateRange: {
          type: 'string',
          enum: DATE_RANGE_SHORTCUTS,
          description:
            "Convenience shortcut for common date ranges. Options: 'today' (since midnight), 'yesterday' (midnight to midnight), 'this_week' (since Monday midnight), 'last_7_days' (past 7 days), 'last_30_days' (past 30 days). Resolves to startDate/endDate using system local timezone. If explicit startDate/endDate are also provided, they take precedence over dateRange. Only applies to read action.",
        },
        startDate: {
          type: 'string',
          description:
            "Filter messages on or after this date. RECOMMENDED format: 'YYYY-MM-DD HH:mm:ss' (local time). Also supports: 'YYYY-MM-DD' or ISO 8601 (e.g., '2025-11-04T09:00:00Z'). Use with endDate for a date range, or alone for 'since date'. Takes precedence over dateRange if both provided. Only applies to read action.",
        },
        endDate: {
          type: 'string',
          description:
            "Filter messages on or before this date. RECOMMENDED format: 'YYYY-MM-DD HH:mm:ss' (local time). Also supports: 'YYYY-MM-DD' or ISO 8601 (e.g., '2025-11-04T17:00:00Z'). Use with startDate for a date range, or alone for 'before date'. Takes precedence over dateRange if both provided. Only applies to read action.",
        },
      },
      required: ['action'],
      dependentSchemas: {
        action: {
          oneOf: [
            { properties: { action: { const: 'read' } } },
            {
              properties: { action: { const: 'create' } },
              required: ['text'],
            },
          ],
        },
      },
    },
  },
  {
    name: 'contacts_people',
    description:
      "Manages Apple Contacts. When looking for a specific person, ALWAYS use the search action with a name, email, or phone query — do not use read to browse for them. The read action returns paginated results (default 50, max 200) which may not include all contacts. If a search returns many results, ask the user follow-up questions to narrow down (e.g., last name, company, phone number) rather than listing all matches. Supports search, read, create, update, and delete actions. Related tools: Use a contact's phone with messages_chat or email with mail_messages to find their messages/emails. Both tools accept contact names directly via the contact param, so you usually don't need to look up details first.",
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: CONTACTS_ACTIONS,
          description: 'The operation to perform.',
        },
        id: {
          type: 'string',
          description:
            'The unique identifier of the contact (REQUIRED for update/delete; optional for read to get single contact).',
        },
        search: {
          type: 'string',
          description:
            'Search term to find contacts by name, email, or phone number (REQUIRED for search action). This is the preferred way to find specific contacts — always use search instead of read when looking for a person.',
        },
        firstName: {
          type: 'string',
          description: 'First name for the contact (for create/update).',
        },
        lastName: {
          type: 'string',
          description: 'Last name for the contact (for create/update).',
        },
        organization: {
          type: 'string',
          description: 'Organization/company name (for create/update).',
        },
        jobTitle: {
          type: 'string',
          description: 'Job title (for create/update).',
        },
        email: {
          type: 'string',
          description: 'Email address (for create).',
          format: 'email',
        },
        emailLabel: {
          type: 'string',
          description:
            'Label for email address (e.g., "work", "home"). Default: "work".',
        },
        phone: {
          type: 'string',
          description: 'Phone number (for create).',
        },
        phoneLabel: {
          type: 'string',
          description:
            'Label for phone number (e.g., "mobile", "home", "work"). Default: "mobile".',
        },
        street: {
          type: 'string',
          description: 'Street address (for create).',
        },
        city: {
          type: 'string',
          description: 'City (for create).',
        },
        state: {
          type: 'string',
          description: 'State/province (for create).',
        },
        zip: {
          type: 'string',
          description: 'ZIP/postal code (for create).',
        },
        country: {
          type: 'string',
          description: 'Country (for create).',
        },
        addressLabel: {
          type: 'string',
          description:
            'Label for address (e.g., "home", "work"). Default: "home".',
        },
        note: {
          type: 'string',
          description: 'Notes for the contact (for create/update).',
        },
        limit: {
          type: 'number',
          description:
            'Maximum number of items to return (1-200, default 50). Results are paginated — a full page does not mean these are all contacts. Use search to find specific people instead of paginating through read results.',
          default: 50,
        },
        offset: {
          type: 'number',
          description: 'Number of items to skip for pagination (default 0).',
          default: 0,
        },
      },
      required: ['action'],
      dependentSchemas: {
        action: {
          oneOf: [
            { properties: { action: { const: 'read' } } },
            {
              properties: { action: { const: 'search' } },
              required: ['search'],
            },
            {
              properties: { action: { const: 'create' } },
            },
            {
              properties: { action: { const: 'update' } },
              required: ['id'],
            },
            {
              properties: { action: { const: 'delete' } },
              required: ['id'],
            },
          ],
        },
      },
    },
  },
];

/**
 * Export TOOLS as Tool[] for MCP server compatibility
 * The dependentSchemas are preserved at runtime even though TypeScript doesn't type-check them
 */
export const TOOLS = _EXTENDED_TOOLS as unknown as Tool[];
