/**
 * handlers/messagesHandlers.ts
 * Read chats and send iMessages via JXA
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
  executeJxaWithRetry,
} from '../../utils/jxaExecutor.js';
import {
  type DateRange,
  getLastMessage,
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

const LIST_CHATS_SCRIPT = `
(() => {
  const Messages = Application("Messages");
  const chats = Messages.chats();
  const result = [];
  const offset = {{offset}};
  const limit = {{limit}};
  const end = Math.min(chats.length, offset + limit);
  for (let i = offset; i < end; i++) {
    const c = chats[i];
    let participants = [];
    try { participants = c.participants().map(p => p.handle()); } catch(e) {}
    let lastMsg = "";
    let lastDate = "";
    try {
      const msgs = c.messages();
      if (msgs.length > 0) {
        const last = msgs[msgs.length - 1];
        lastMsg = (last.text() || "").substring(0, 100);
        lastDate = last.date().toISOString();
      }
    } catch(e) {}
    result.push({
      id: c.id(),
      name: c.name() || participants.join(", ") || "Unknown",
      participants: participants,
      lastMessage: lastMsg,
      lastDate: lastDate
    });
  }
  return JSON.stringify(result);
})()
`;

const READ_CHAT_MESSAGES_SCRIPT = `
(() => {
  const Messages = Application("Messages");
  const chats = Messages.chats.whose({id: "{{chatId}}"})();
  if (chats.length === 0) return JSON.stringify([]);
  try {
    const msgs = chats[0].messages();
    const result = [];
    const offset = {{offset}};
    const limit = {{limit}};
    const start = Math.max(0, msgs.length - offset - limit);
    const end = Math.max(0, msgs.length - offset);
    for (let i = start; i < end; i++) {
      try {
        const m = msgs[i];
        result.push({
          id: m.id().toString(),
          text: m.text() || "",
          sender: m.sender() || "me",
          date: m.date().toISOString(),
          isFromMe: m.sender() === null
        });
      } catch(e) { /* skip corrupt message */ }
    }
    return JSON.stringify(result);
  } catch(e) {
    return JSON.stringify({error: "Unable to read messages from this chat. The chat data may be in an incompatible format."});
  }
})()
`;

const SEND_TO_CHAT_SCRIPT = `
(() => {
  const Messages = Application("Messages");
  const chats = Messages.chats.whose({id: "{{chatId}}"})();
  if (chats.length === 0) throw new Error("Chat not found");
  Messages.send("{{text}}", {to: chats[0]});
  return JSON.stringify({sent: true, chatId: "{{chatId}}"});
})()
`;

const SEARCH_CHATS_SCRIPT = `
(() => {
  const Messages = Application("Messages");
  const chats = Messages.chats();
  const term = "{{search}}".toLowerCase();
  const result = [];
  const limit = {{limit}};
  for (let i = 0; i < chats.length && result.length < limit; i++) {
    const c = chats[i];
    let participants = [];
    try { participants = c.participants().map(p => p.handle()); } catch(e) {}
    const name = c.name() || participants.join(", ") || "Unknown";
    if (name.toLowerCase().includes(term) || participants.some(p => p.toLowerCase().includes(term))) {
      let lastMsg = "";
      let lastDate = "";
      try {
        const msgs = c.messages();
        if (msgs.length > 0) {
          const last = msgs[msgs.length - 1];
          lastMsg = (last.text() || "").substring(0, 100);
          lastDate = last.date().toISOString();
        }
      } catch(e) {}
      result.push({
        id: c.id(),
        name: name,
        participants: participants,
        lastMessage: lastMsg,
        lastDate: lastDate
      });
    }
  }
  return JSON.stringify(result);
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

const SEARCH_MESSAGES_SCRIPT = `
(() => {
  const Messages = Application("Messages");
  const chats = Messages.chats();
  const term = "{{search}}".toLowerCase();
  const result = [];
  const limit = {{limit}};
  for (let ci = 0; ci < chats.length && result.length < limit; ci++) {
    const c = chats[ci];
    let chatName = "";
    try {
      const parts = c.participants().map(p => p.handle());
      chatName = c.name() || parts.join(", ") || "Unknown";
    } catch(e) { chatName = c.name() || "Unknown"; }
    try {
      const msgs = c.messages();
      const start = Math.max(0, msgs.length - 200);
      for (let i = start; i < msgs.length && result.length < limit; i++) {
        try {
          const m = msgs[i];
          const text = m.text() || "";
          if (text.toLowerCase().includes(term)) {
            result.push({
              chatId: c.id(),
              chatName: chatName,
              id: m.id().toString(),
              text: text.substring(0, 300),
              sender: m.sender() || "me",
              date: m.date().toISOString(),
              isFromMe: m.sender() === null
            });
          }
        } catch(e) {}
      }
    } catch(e) {}
  }
  return JSON.stringify(result);
})()
`;

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

// --- Handlers ---

/**
 * Attempts to read messages via JXA first, falls back to SQLite.
 * JXA's c.messages() throws "Can't convert types" on modern macOS,
 * so SQLite (requires Full Disk Access) is the primary read path.
 * When date filtering is requested, skips JXA (no date filter support) and goes directly to SQLite.
 */
async function readMessagesWithFallback(
  chatId: string,
  limit: number,
  offset: number,
  dateRange?: DateRange,
): Promise<MessageItem[]> {
  // Skip JXA when date filtering is requested (JXA does not support date filtering)
  if (!dateRange?.startDate && !dateRange?.endDate) {
    // Try JXA first (works on some macOS versions)
    try {
      const script = buildScript(READ_CHAT_MESSAGES_SCRIPT, {
        chatId,
        limit: String(limit),
        offset: String(offset),
      });
      const result = await executeJxaWithRetry<
        MessageItem[] | { error: string }
      >(script, 15000, 'Messages');
      if (Array.isArray(result) && result.length > 0) {
        return result;
      }
    } catch {
      // JXA failed, try SQLite
    }
  }

  // SQLite fallback (or primary path when date filtering)
  try {
    return await readChatMessages(chatId, limit, offset, dateRange);
  } catch (error) {
    if (error instanceof SqliteAccessError && error.isPermissionError) {
      throw new Error(
        'Cannot read messages: JXA automation is unsupported for message reading on this macOS version, ' +
          'and SQLite access requires Full Disk Access. ' +
          'Grant Full Disk Access to your terminal app in System Settings > Privacy & Security > Full Disk Access.',
      );
    }
    throw error;
  }
}

async function searchMessagesWithFallback(
  search: string,
  limit: number,
  dateRange?: DateRange,
): Promise<SearchMessageResult[]> {
  // Skip JXA when date filtering is requested (JXA does not support date filtering)
  if (!dateRange?.startDate && !dateRange?.endDate) {
    // Try JXA first
    try {
      const script = buildScript(SEARCH_MESSAGES_SCRIPT, {
        search,
        limit: String(limit),
      });
      const results = await executeJxaWithRetry<SearchMessageResult[]>(
        script,
        30000,
        'Messages',
      );
      if (results.length > 0) {
        return results;
      }
    } catch {
      // JXA failed, try SQLite
    }
  }

  // SQLite fallback (or primary path when date filtering)
  try {
    return await searchMessages(search, limit, dateRange);
  } catch (error) {
    if (error instanceof SqliteAccessError && error.isPermissionError) {
      throw new Error(
        'Cannot search messages: JXA automation is unsupported for message reading on this macOS version, ' +
          'and SQLite access requires Full Disk Access. ' +
          'Grant Full Disk Access to your terminal app in System Settings > Privacy & Security > Full Disk Access.',
      );
    }
    throw error;
  }
}

/**
 * Attempts to list chats via JXA first, falls back to SQLite.
 * JXA's Messages.chats() throws errors on macOS Sonoma+,
 * so SQLite (requires Full Disk Access) is the fallback.
 */
async function listChatsWithFallback(
  limit: number,
  offset: number,
): Promise<ChatItem[]> {
  // Try JXA first (works on some macOS versions)
  try {
    const script = buildScript(LIST_CHATS_SCRIPT, {
      limit: String(limit),
      offset: String(offset),
    });
    const chats = await executeJxaWithRetry<ChatItem[]>(
      script,
      15000,
      'Messages',
    );
    if (Array.isArray(chats) && chats.length > 0) {
      // Try to enrich chats that are missing lastMessage with SQLite data
      for (const chat of chats) {
        if (!chat.lastMessage) {
          try {
            const last = await getLastMessage(chat.id);
            if (last) {
              chat.lastMessage = last.text;
              chat.lastDate = last.date;
            }
          } catch {
            // SQLite unavailable, skip enrichment
            break; // No point trying other chats
          }
        }
      }
      return chats;
    }
  } catch {
    // JXA failed, try SQLite
  }

  // SQLite fallback
  try {
    return await listChats(limit, offset);
  } catch (error) {
    if (error instanceof SqliteAccessError && error.isPermissionError) {
      throw new Error(
        'Cannot list chats: JXA automation is unsupported on this macOS version, ' +
          'and SQLite access requires Full Disk Access. ' +
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
        let results = await searchMessagesWithFallback(
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
      const script = buildScript(SEARCH_CHATS_SCRIPT, {
        search: validated.search,
        limit: String(validated.limit),
      });
      let chats = await executeJxaWithRetry<ChatItem[]>(
        script,
        15000,
        'Messages',
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
      let messages = await readMessagesWithFallback(
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

    // List chats — try JXA first, fall back to SQLite
    let chats = await listChatsWithFallback(
      validated.limit ?? 50,
      validated.offset ?? 0,
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
