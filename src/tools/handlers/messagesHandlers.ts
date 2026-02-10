/**
 * handlers/messagesHandlers.ts
 * Read chats via SQLite, send iMessages via JXA
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { DateRangeShortcut, MessagesToolArgs } from '../../types/index.js';
import {
  ContactSearchError,
  contactResolver,
  type ResolvedContact,
} from '../../utils/contactResolver.js';
import { handleAsyncOperation } from '../../utils/errorHandling.js';
import {
  buildScript,
  executeAppleScript,
  executeJxa,
} from '../../utils/jxaExecutor.js';
import {
  type DateRange,
  listChats,
  readChatMessages,
  readMessagesByHandles,
  SqliteAccessError,
  searchMessages,
} from '../../utils/sqliteMessageReader.js';
import {
  CreateMessageSchema,
  ReadMessagesSchema,
} from '../../validation/schemas.js';
import { extractAndValidateArgs, formatListMarkdown } from './shared.js';

/**
 * Formats a local Date to 'YYYY-MM-DD HH:mm:ss' for consumption by the existing
 * date filtering infrastructure (dateToAppleTimestamp).
 */
function formatLocalDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Resolves a dateRange shortcut to explicit start/end date strings.
 * All dates use system local timezone via `new Date(year, month, date)`.
 * Monday is used as start of week (ISO standard).
 */
export function resolveDateRange(range: DateRangeShortcut): {
  startDate: string;
  endDate: string;
} {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );

  switch (range) {
    case 'today':
      return {
        startDate: formatLocalDate(startOfToday),
        endDate: formatLocalDate(now),
      };
    case 'yesterday': {
      const startOfYesterday = new Date(
        startOfToday.getFullYear(),
        startOfToday.getMonth(),
        startOfToday.getDate() - 1,
      );
      return {
        startDate: formatLocalDate(startOfYesterday),
        endDate: formatLocalDate(startOfToday),
      };
    }
    case 'this_week': {
      // Monday as start of week (ISO standard)
      // getDay(): 0=Sunday, 1=Monday, ..., 6=Saturday
      const dayOfWeek = now.getDay();
      // Days since Monday: Sunday(0)→6, Monday(1)→0, Tuesday(2)→1, etc.
      const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const startOfWeek = new Date(
        startOfToday.getFullYear(),
        startOfToday.getMonth(),
        startOfToday.getDate() - daysSinceMonday,
      );
      return {
        startDate: formatLocalDate(startOfWeek),
        endDate: formatLocalDate(now),
      };
    }
    case 'last_7_days': {
      const sevenDaysAgo = new Date(
        startOfToday.getFullYear(),
        startOfToday.getMonth(),
        startOfToday.getDate() - 7,
      );
      return {
        startDate: formatLocalDate(sevenDaysAgo),
        endDate: formatLocalDate(now),
      };
    }
    case 'last_30_days': {
      const thirtyDaysAgo = new Date(
        startOfToday.getFullYear(),
        startOfToday.getMonth(),
        startOfToday.getDate() - 30,
      );
      return {
        startDate: formatLocalDate(thirtyDaysAgo),
        endDate: formatLocalDate(now),
      };
    }
  }
}

interface ChatItem {
  id: string;
  name: string;
  participants: string[];
  lastMessage: string;
  lastDate: string;
}

interface MessageItem {
  id: string;
  text: string;
  sender: string;
  date: string;
  isFromMe: boolean;
}

// --- JXA Script Templates ---

const SEND_TO_CHAT_SCRIPT = `
(() => {
  const Messages = Application("Messages");
  const chats = Messages.chats.whose({id: "{{chatId}}"})();
  if (chats.length === 0) throw new Error("Chat not found");
  Messages.send("{{text}}", {to: chats[0]});
  return JSON.stringify({sent: true, chatId: "{{chatId}}"});
})()
`;

interface SearchMessageResult {
  chatId: string;
  chatName: string;
  id: string;
  text: string;
  sender: string;
  date: string;
  isFromMe: boolean;
}

// --- Contact Enrichment ---

/**
 * Enriches messages with contact names instead of phone numbers.
 * Only enriches incoming messages (not isFromMe) with known senders.
 */
async function enrichMessagesWithContacts(
  messages: MessageItem[],
): Promise<MessageItem[]> {
  const handles = [
    ...new Set(
      messages
        .filter((m) => !m.isFromMe && m.sender !== 'unknown')
        .map((m) => m.sender),
    ),
  ];
  if (handles.length === 0) return messages;

  const resolved = await contactResolver.resolveBatch(handles);
  return messages.map((m) => ({
    ...m,
    sender:
      !m.isFromMe && m.sender !== 'unknown'
        ? resolved.get(m.sender)?.fullName || m.sender
        : m.sender,
  }));
}

/**
 * Enriches search results with contact names.
 */
async function enrichSearchMessagesWithContacts(
  messages: SearchMessageResult[],
): Promise<SearchMessageResult[]> {
  const handles = [
    ...new Set(
      messages
        .filter((m) => !m.isFromMe && m.sender !== 'unknown')
        .map((m) => m.sender),
    ),
  ];
  if (handles.length === 0) return messages;

  const resolved = await contactResolver.resolveBatch(handles);
  return messages.map((m) => ({
    ...m,
    sender:
      !m.isFromMe && m.sender !== 'unknown'
        ? resolved.get(m.sender)?.fullName || m.sender
        : m.sender,
  }));
}

/**
 * Rebuilds chat name from resolved contacts when the original name
 * was just comma-separated phone numbers (no iMessage display_name).
 */
function rebuildChatName(
  chat: ChatItem,
  resolved: Map<string, ResolvedContact>,
): string {
  // If chat name doesn't look like it was built from phone numbers, keep it
  const looksLikePhoneList = chat.participants?.some((p) =>
    chat.name.includes(p),
  );
  if (!looksLikePhoneList) return chat.name;

  // Rebuild from resolved names
  const names =
    chat.participants?.map((p) => resolved.get(p)?.fullName || p) || [];
  return names.join(', ') || chat.name;
}

/**
 * Enriches chat participants with contact names instead of phone numbers.
 * Participants show "Name (+number)" format; chat name is rebuilt from names only.
 */
async function enrichChatParticipants(chats: ChatItem[]): Promise<ChatItem[]> {
  const handles = [...new Set(chats.flatMap((c) => c.participants || []))];
  if (handles.length === 0) return chats;

  const resolved = await contactResolver.resolveBatch(handles);
  return chats.map((c) => ({
    ...c,
    participants: c.participants?.map((p) => {
      const name = resolved.get(p)?.fullName;
      return name ? `${name} (${p})` : p;
    }),
    name: rebuildChatName(c, resolved),
  }));
}

// --- Formatting ---

function formatChatMarkdown(chat: ChatItem): string[] {
  const lines = [`- **${chat.name}**`];
  lines.push(`  - ID: ${chat.id}`);
  if (chat.participants.length > 0) {
    lines.push(`  - Participants: ${chat.participants.join(', ')}`);
  }
  if (chat.lastMessage) {
    lines.push(`  - Last: ${chat.lastMessage}`);
  }
  if (chat.lastDate) {
    lines.push(`  - Date: ${chat.lastDate}`);
  }
  return lines;
}

function formatMessageMarkdown(msg: MessageItem): string[] {
  const sender = msg.isFromMe ? 'Me' : msg.sender;
  return [`- [${msg.date}] **${sender}**: ${msg.text}`];
}

function formatSearchMessageMarkdown(msg: SearchMessageResult): string[] {
  const sender = msg.isFromMe ? 'Me' : msg.sender;
  return [
    `- [${msg.date}] **${sender}** in *${msg.chatName}*: ${msg.text}`,
    `  - Chat ID: ${msg.chatId}`,
  ];
}

// --- SQLite Read Wrappers ---

/**
 * Reads messages from a chat via SQLite.
 * JXA message reading is broken on macOS Sonoma+ ("Can't convert types"),
 * so all message reads go through SQLite directly.
 */
async function readChatMessagesSqlite(
  chatId: string,
  limit: number,
  offset: number,
  dateRange?: DateRange,
): Promise<MessageItem[]> {
  try {
    return await readChatMessages(chatId, limit, offset, dateRange);
  } catch (error) {
    if (error instanceof SqliteAccessError && error.isPermissionError) {
      throw new Error(
        'Cannot read messages: SQLite access requires Full Disk Access. ' +
          'Grant Full Disk Access to your terminal app in System Settings > Privacy & Security > Full Disk Access.',
      );
    }
    throw error;
  }
}

/**
 * Searches messages by content via SQLite.
 */
async function searchMessagesSqlite(
  search: string,
  limit: number,
  dateRange?: DateRange,
): Promise<SearchMessageResult[]> {
  try {
    return await searchMessages(search, limit, dateRange);
  } catch (error) {
    if (error instanceof SqliteAccessError && error.isPermissionError) {
      throw new Error(
        'Cannot search messages: SQLite access requires Full Disk Access. ' +
          'Grant Full Disk Access to your terminal app in System Settings > Privacy & Security > Full Disk Access.',
      );
    }
    throw error;
  }
}

/**
 * Lists chats via SQLite, with optional search and date filtering.
 */
async function listChatsSqlite(
  limit: number,
  offset: number,
  dateRange?: DateRange,
  search?: string,
): Promise<ChatItem[]> {
  try {
    return await listChats(limit, offset, dateRange, search);
  } catch (error) {
    if (error instanceof SqliteAccessError && error.isPermissionError) {
      throw new Error(
        'Cannot list chats: SQLite access requires Full Disk Access. ' +
          'Grant Full Disk Access to your terminal app in System Settings > Privacy & Security > Full Disk Access.',
      );
    }
    throw error;
  }
}

/**
 * Reads messages by phone handles (for contact reverse lookup).
 * Uses SQLite directly since JXA does not support handle-based queries.
 */
async function readMessagesByHandlesWithFallback(
  handles: string[],
  limit: number,
  dateRange?: DateRange,
): Promise<SearchMessageResult[]> {
  try {
    return await readMessagesByHandles(handles, limit, dateRange);
  } catch (error) {
    if (error instanceof SqliteAccessError && error.isPermissionError) {
      throw new Error(
        'Cannot read messages by contact: SQLite access requires Full Disk Access. ' +
          'Grant Full Disk Access to your terminal app in System Settings > Privacy & Security > Full Disk Access.',
      );
    }
    throw error;
  }
}

export async function handleReadMessages(
  args: MessagesToolArgs,
): Promise<CallToolResult> {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, ReadMessagesSchema);
    const paginationMeta = { limit: validated.limit, offset: validated.offset };

    // Resolve dateRange shortcut to start/end dates, then allow explicit dates to override
    let effectiveStartDate = validated.startDate;
    let effectiveEndDate = validated.endDate;

    if (validated.dateRange && !validated.startDate && !validated.endDate) {
      // dateRange shortcut only applies when explicit dates are NOT provided
      const resolved = resolveDateRange(validated.dateRange);
      effectiveStartDate = resolved.startDate;
      effectiveEndDate = resolved.endDate;
    }

    // Build date range filter if either date param is provided
    const dateRange: DateRange | undefined =
      effectiveStartDate || effectiveEndDate
        ? { startDate: effectiveStartDate, endDate: effectiveEndDate }
        : undefined;

    // Find messages from a contact by name (reverse lookup)
    if (validated.contact) {
      let handles: Awaited<
        ReturnType<typeof contactResolver.resolveNameToHandles>
      >;
      try {
        handles = await contactResolver.resolveNameToHandles(validated.contact);
      } catch (error) {
        if (error instanceof ContactSearchError) {
          return error.isTimeout
            ? `Contact search timed out for "${validated.contact}". The Contacts app may be slow to respond. Please try again.`
            : `Contact search failed for "${validated.contact}": ${error.message}`;
        }
        throw error;
      }
      if (
        !handles ||
        (handles.phones.length === 0 && handles.emails.length === 0)
      ) {
        return `No contact found matching "${validated.contact}", or the contact has no phone numbers or email addresses associated.`;
      }

      // Combine phones and emails as message handles (iMessage uses both)
      const allHandles = [...handles.phones, ...handles.emails];

      let results = await readMessagesByHandlesWithFallback(
        allHandles,
        validated.limit ?? 50,
        dateRange,
      );
      if (validated.enrichContacts !== false) {
        results = await enrichSearchMessagesWithContacts(results);
      }
      return formatListMarkdown(
        `Messages from contact "${validated.contact}"`,
        results,
        formatSearchMessageMarkdown,
        `No messages found from contact "${validated.contact}".`,
        { includeTimezone: true },
      );
    }

    // Search chats by participant/name or search messages by content
    if (validated.search) {
      if (validated.searchMessages) {
        let results = await searchMessagesSqlite(
          validated.search,
          validated.limit ?? 50,
          dateRange,
        );
        if (validated.enrichContacts !== false) {
          results = await enrichSearchMessagesWithContacts(results);
        }
        return formatListMarkdown(
          `Messages matching "${validated.search}"`,
          results,
          formatSearchMessageMarkdown,
          'No messages found matching search.',
          { includeTimezone: true },
        );
      }
      // Search chats by name/participant via SQLite
      let chats = await listChatsSqlite(
        validated.limit ?? 50,
        0,
        dateRange,
        validated.search,
      );
      if (validated.enrichContacts !== false) {
        chats = await enrichChatParticipants(chats);
      }
      return formatListMarkdown(
        `Chats matching "${validated.search}"`,
        chats,
        formatChatMarkdown,
        'No chats found matching search.',
        { includeTimezone: true },
      );
    }

    if (validated.chatId) {
      let messages = await readChatMessagesSqlite(
        validated.chatId,
        validated.limit ?? 50,
        validated.offset ?? 0,
        dateRange,
      );
      if (validated.enrichContacts !== false) {
        messages = await enrichMessagesWithContacts(messages);
      }
      return formatListMarkdown(
        'Messages',
        messages,
        formatMessageMarkdown,
        'No messages in this chat.',
        { pagination: paginationMeta, includeTimezone: true },
      );
    }

    // List chats via SQLite
    let chats = await listChatsSqlite(
      validated.limit ?? 50,
      validated.offset ?? 0,
      dateRange,
    );
    if (validated.enrichContacts !== false) {
      chats = await enrichChatParticipants(chats);
    }

    return formatListMarkdown(
      'Chats',
      chats,
      formatChatMarkdown,
      'No chats found.',
      { pagination: paginationMeta, includeTimezone: true },
    );
  }, 'read messages');
}

export async function handleCreateMessage(
  args: MessagesToolArgs,
): Promise<CallToolResult> {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, CreateMessageSchema);

    if (validated.chatId) {
      const script = buildScript(SEND_TO_CHAT_SCRIPT, {
        chatId: validated.chatId,
        text: validated.text,
      });
      await executeJxa(script, 15000, 'Messages');
      return `Successfully sent message to chat "${validated.chatId}".`;
    }

    if (!validated.to) {
      throw new Error('Either "to" or "chatId" is required to send a message.');
    }

    const appleScript = `tell application "Messages"
    set targetService to 1st account whose service type = iMessage
    set targetBuddy to participant "${validated.to.replace(/"/g, '\\"')}" of targetService
    send "${validated.text.replace(/"/g, '\\"')}" to targetBuddy
end tell`;
    await executeAppleScript(appleScript, 15000, 'Messages');
    return `Successfully sent message to ${validated.to}.`;
  }, 'send message');
}
