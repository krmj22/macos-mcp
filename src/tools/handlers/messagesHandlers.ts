/**
 * handlers/messagesHandlers.ts
 * Read chats and send iMessages via JXA
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { MessagesToolArgs } from '../../types/index.js';
import { handleAsyncOperation } from '../../utils/errorHandling.js';
import {
  buildScript,
  executeAppleScript,
  executeJxa,
  executeJxaWithRetry,
} from '../../utils/jxaExecutor.js';
import {
  getLastMessage,
  readChatMessages,
  SqliteAccessError,
  searchMessages,
} from '../../utils/sqliteMessageReader.js';
import {
  CreateMessageSchema,
  ReadMessagesSchema,
} from '../../validation/schemas.js';
import { extractAndValidateArgs, formatListMarkdown } from './shared.js';

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
 */
async function readMessagesWithFallback(
  chatId: string,
  limit: number,
  offset: number,
): Promise<MessageItem[]> {
  // Try JXA first (works on some macOS versions)
  try {
    const script = buildScript(READ_CHAT_MESSAGES_SCRIPT, {
      chatId,
      limit: String(limit),
      offset: String(offset),
    });
    const result = await executeJxaWithRetry<MessageItem[] | { error: string }>(
      script,
      15000,
      'Messages',
    );
    if (Array.isArray(result) && result.length > 0) {
      return result;
    }
  } catch {
    // JXA failed, try SQLite
  }

  // SQLite fallback
  try {
    return await readChatMessages(chatId, limit, offset);
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
): Promise<SearchMessageResult[]> {
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

  // SQLite fallback
  try {
    return await searchMessages(search, limit);
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

export async function handleReadMessages(
  args: MessagesToolArgs,
): Promise<CallToolResult> {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, ReadMessagesSchema);
    const paginationMeta = { limit: validated.limit, offset: validated.offset };

    // Search chats by participant/name or search messages by content
    if (validated.search) {
      if (validated.searchMessages) {
        const results = await searchMessagesWithFallback(
          validated.search,
          validated.limit ?? 50,
        );
        return formatListMarkdown(
          `Messages matching "${validated.search}"`,
          results,
          formatSearchMessageMarkdown,
          'No messages found matching search.',
        );
      }
      const script = buildScript(SEARCH_CHATS_SCRIPT, {
        search: validated.search,
        limit: String(validated.limit),
      });
      const chats = await executeJxaWithRetry<ChatItem[]>(
        script,
        15000,
        'Messages',
      );
      return formatListMarkdown(
        `Chats matching "${validated.search}"`,
        chats,
        formatChatMarkdown,
        'No chats found matching search.',
      );
    }

    if (validated.chatId) {
      const messages = await readMessagesWithFallback(
        validated.chatId,
        validated.limit ?? 50,
        validated.offset ?? 0,
      );
      return formatListMarkdown(
        'Messages',
        messages,
        formatMessageMarkdown,
        'No messages in this chat.',
        paginationMeta,
      );
    }

    // List chats — enrich with last message via SQLite when possible
    const paginationParams = {
      limit: String(validated.limit),
      offset: String(validated.offset),
    };
    const script = buildScript(LIST_CHATS_SCRIPT, paginationParams);
    const chats = await executeJxaWithRetry<ChatItem[]>(
      script,
      15000,
      'Messages',
    );

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

    return formatListMarkdown(
      'Chats',
      chats,
      formatChatMarkdown,
      'No chats found.',
      paginationMeta,
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
