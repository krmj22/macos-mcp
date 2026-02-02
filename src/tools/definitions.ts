/**
 * tools/definitions.ts
 * MCP tool definitions for Apple Reminders server, adhering to standard JSON Schema.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  CALENDAR_ACTIONS,
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
      'Manages reminder tasks. Supports reading, creating, updating, and deleting reminders.',
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
      'Manages reminder lists. Supports reading, creating, updating, and deleting reminder lists.',
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
      'Manages calendar events (time blocks). Supports reading, creating, updating, and deleting calendar events.',
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
            "Start date and time. RECOMMENDED format: 'YYYY-MM-DD HH:mm:ss' (local time without timezone, e.g., '2025-11-04 09:00:00'). Also supports: 'YYYY-MM-DD', 'YYYY-MM-DDTHH:mm:ss', or ISO 8601 with timezone. When no timezone is specified, the time is interpreted as local time.",
        },
        endDate: {
          type: 'string',
          description:
            "End date and time. RECOMMENDED format: 'YYYY-MM-DD HH:mm:ss' (local time without timezone, e.g., '2025-11-04 10:00:00'). Also supports: 'YYYY-MM-DD', 'YYYY-MM-DDTHH:mm:ss', or ISO 8601 with timezone. When no timezone is specified, the time is interpreted as local time.",
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
      'Reads calendar collections. Use to inspect available calendars before creating or updating events.',
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
      'Manages Apple Notes. Supports reading, creating, updating, and deleting notes.',
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
          description: 'The title of the note (REQUIRED for create).',
        },
        body: {
          type: 'string',
          description: 'The body content of the note.',
        },
        folder: {
          type: 'string',
          description:
            'The folder name — for create (defaults to Notes) or for read to filter by folder.',
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
      'Manages Apple Notes folders. Supports listing all folders and creating new ones.',
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
      'Manages Apple Mail. Supports reading inbox/mailboxes, searching messages (subject, sender, body), reading individual messages, sending mail with CC/BCC, replying, marking read/unread, and deleting.',
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
            'ID of the message to reply to. Prefills Re: subject and quotes body.',
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
      'Manages Apple Messages (iMessage). Supports reading chats and messages, searching chats by participant/name, searching messages by content, and sending new iMessages.',
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
            'When true with search, searches message content instead of chat names/participants.',
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
];

/**
 * Export TOOLS as Tool[] for MCP server compatibility
 * The dependentSchemas are preserved at runtime even though TypeScript doesn't type-check them
 */
export const TOOLS = _EXTENDED_TOOLS as unknown as Tool[];
