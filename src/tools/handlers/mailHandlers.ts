/**
 * handlers/mailHandlers.ts
 * Mail operations: SQLite for reads, JXA for writes.
 * See ADR-001 in DECISION.md for architectural context.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { MailToolArgs } from '../../types/index.js';
import {
  ContactSearchError,
  contactResolver,
} from '../../utils/contactResolver.js';
import { handleAsyncOperation } from '../../utils/errorHandling.js';
import {
  executeJxa,
  executeJxaWithRetry,
  sanitizeForJxa,
} from '../../utils/jxaExecutor.js';
import {
  getMessageById,
  listInboxMessages,
  listMailboxes,
  listMailboxMessages,
  type MailMessage,
  SqliteMailAccessError,
  searchBySenderEmails,
  searchMessages,
} from '../../utils/sqliteMailReader.js';
import { formatTimezoneInfo, getSystemTimezone } from '../../utils/timezone.js';
import {
  CreateMailSchema,
  DeleteMailSchema,
  ReadMailSchema,
  UpdateMailSchema,
} from '../../validation/schemas.js';
import { extractAndValidateArgs, formatListMarkdown } from './shared.js';

interface MailboxItem {
  name: string;
  account: string;
  unreadCount: number;
}

// --- Contact Enrichment ---

/**
 * Enriches mail senders with contact names instead of email addresses.
 */
async function enrichMailSenders(
  messages: MailMessage[],
): Promise<MailMessage[]> {
  const addresses = [...new Set(messages.map((m) => m.sender).filter(Boolean))];
  if (addresses.length === 0) return messages;

  const resolved = await contactResolver.resolveBatch(addresses);
  return messages.map((m) => ({
    ...m,
    senderName: resolved.get(m.sender)?.fullName || m.senderName || m.sender,
  }));
}

// --- JXA Scripts (writes only) ---

const GET_MAIL_SCRIPT_JXA = `
(() => {
  const Mail = Application("Mail");
  const accounts = Mail.accounts();
  for (let a = 0; a < accounts.length; a++) {
    const mailboxes = accounts[a].mailboxes();
    for (let b = 0; b < mailboxes.length; b++) {
      const msgs = mailboxes[b].messages.whose({id: {{id}}})();
      if (msgs.length > 0) {
        const m = msgs[0];
        return JSON.stringify({
          id: m.id().toString(),
          content: m.content() || ""
        });
      }
    }
  }
  return JSON.stringify(null);
})()
`;

const MARK_READ_SCRIPT = `
(() => {
  const Mail = Application("Mail");
  const accounts = Mail.accounts();
  for (let a = 0; a < accounts.length; a++) {
    const mailboxes = accounts[a].mailboxes();
    for (let b = 0; b < mailboxes.length; b++) {
      const msgs = mailboxes[b].messages.whose({id: {{id}}})();
      if (msgs.length > 0) {
        msgs[0].readStatus = {{readStatus}};
        return JSON.stringify({updated: true, id: {{id}}, read: {{readStatus}}});
      }
    }
  }
  throw new Error("Message not found");
})()
`;

const DELETE_MAIL_SCRIPT = `
(() => {
  const Mail = Application("Mail");
  const accounts = Mail.accounts();
  for (let a = 0; a < accounts.length; a++) {
    const mailboxes = accounts[a].mailboxes();
    for (let b = 0; b < mailboxes.length; b++) {
      const msgs = mailboxes[b].messages.whose({id: {{id}}})();
      if (msgs.length > 0) {
        Mail.delete(msgs[0]);
        return JSON.stringify({deleted: true, id: {{id}}});
      }
    }
  }
  throw new Error("Message not found");
})()
`;

// --- Formatting ---

function formatMailMarkdown(msg: MailMessage): string[] {
  const status = msg.read ? '' : ' [UNREAD]';
  const displaySender = msg.senderName || msg.sender;
  const lines = [`- **${msg.subject}**${status}`];
  lines.push(`  - ID: ${msg.id}`);
  lines.push(`  - From: ${displaySender}`);
  lines.push(`  - Date: ${msg.dateReceived}`);
  lines.push(`  - Account: ${msg.account}`);
  if (msg.preview) {
    const preview = msg.preview.replace(/\n/g, ' ').substring(0, 150);
    lines.push(`  - Preview: ${preview}...`);
  }
  return lines;
}

function formatMailboxMarkdown(mb: MailboxItem): string[] {
  return [`- **${mb.name}** (${mb.account})`, `  - Unread: ${mb.unreadCount}`];
}

// --- Handlers ---

export async function handleReadMail(
  args: MailToolArgs,
): Promise<CallToolResult> {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, ReadMailSchema);

    try {
      // Get single message by ID (SQLite metadata + JXA for full content)
      if (validated.id) {
        const msg = await getMessageById(validated.id);
        if (!msg) return 'Mail message not found.';

        // Fetch full content via JXA (SQLite only has summaries)
        let content = msg.preview;
        try {
          const jxaScript = GET_MAIL_SCRIPT_JXA.replace(
            /\{\{id\}\}/g,
            validated.id,
          );
          const jxaResult = await executeJxaWithRetry<{
            id: string;
            content: string;
          } | null>(jxaScript, 10000, 'Mail');
          if (jxaResult?.content) {
            content = jxaResult.content;
          }
        } catch {
          // Fall back to SQLite summary if JXA fails
        }

        let senderDisplay = msg.senderName || msg.sender;
        if (validated.enrichContacts !== false) {
          const resolved = await contactResolver.resolveHandle(msg.sender);
          senderDisplay = resolved?.fullName || senderDisplay;
        }
        const tz = getSystemTimezone();
        return [
          `### Mail: ${msg.subject}`,
          '',
          `- ID: ${msg.id}`,
          `- From: ${senderDisplay}`,
          `- To: ${msg.toRecipients.join(', ')}`,
          msg.ccRecipients.length > 0
            ? `- CC: ${msg.ccRecipients.join(', ')}`
            : null,
          `- Date: ${msg.dateReceived}`,
          `- Mailbox: ${msg.mailbox}`,
          `- Account: ${msg.account}`,
          '',
          '**Content:**',
          content,
          '',
          `*User timezone: ${formatTimezoneInfo(tz)}*`,
        ]
          .filter(Boolean)
          .join('\n');
      }

      const limit = validated.limit ?? 50;
      const offset = validated.offset ?? 0;
      const paginationMeta = { limit, offset };

      // Find emails from a contact by name (reverse lookup)
      if (validated.contact) {
        let handles: Awaited<
          ReturnType<typeof contactResolver.resolveNameToHandles>
        >;
        try {
          handles = await contactResolver.resolveNameToHandles(
            validated.contact,
          );
        } catch (error) {
          if (error instanceof ContactSearchError) {
            return error.isTimeout
              ? `Contact search timed out for "${validated.contact}". The Contacts app may be slow to respond. Please try again.`
              : `Contact search failed for "${validated.contact}": ${error.message}`;
          }
          throw error;
        }
        if (!handles || handles.emails.length === 0) {
          return `No contact found matching "${validated.contact}", or the contact has no email addresses associated.`;
        }

        let messages = await searchBySenderEmails(handles.emails, limit);
        if (validated.enrichContacts !== false) {
          messages = await enrichMailSenders(messages);
        }
        return formatListMarkdown(
          `Mail from contact "${validated.contact}"`,
          messages,
          formatMailMarkdown,
          `No messages found from contact "${validated.contact}".`,
          { pagination: paginationMeta, includeTimezone: true },
        );
      }

      // List mailboxes
      if (validated.mailbox === '_list') {
        const mailboxes = await listMailboxes();
        const items: MailboxItem[] = mailboxes.map((mb) => ({
          name: mb.name,
          account: mb.account,
          unreadCount: mb.unreadCount,
        }));
        return formatListMarkdown(
          'Mailboxes',
          items,
          formatMailboxMarkdown,
          'No mailboxes found.',
        );
      }

      // Read from specific mailbox
      if (validated.mailbox) {
        // Resolve mailbox name to URL
        const allMailboxes = await listMailboxes();
        const match = allMailboxes.find(
          (mb) =>
            mb.name.toLowerCase() === validated.mailbox?.toLowerCase() &&
            (!validated.account ||
              mb.account.toLowerCase() === validated.account?.toLowerCase()),
        );
        if (!match) {
          return `Mailbox "${validated.mailbox}" not found. Use mailbox: "_list" to see available mailboxes.`;
        }

        let messages = await listMailboxMessages(match.url, limit, offset);
        if (validated.enrichContacts !== false) {
          messages = await enrichMailSenders(messages);
        }
        return formatListMarkdown(
          `Mailbox: ${validated.mailbox}`,
          messages,
          formatMailMarkdown,
          'No messages in this mailbox.',
          { pagination: paginationMeta, includeTimezone: true },
        );
      }

      // Search
      if (validated.search) {
        let messages = await searchMessages(validated.search, limit, offset);
        if (validated.enrichContacts !== false) {
          messages = await enrichMailSenders(messages);
        }
        return formatListMarkdown(
          `Mail matching "${validated.search}"`,
          messages,
          formatMailMarkdown,
          'No messages found matching search.',
          { pagination: paginationMeta, includeTimezone: true },
        );
      }

      // Default: list inbox
      let messages = await listInboxMessages(limit, offset);
      if (validated.enrichContacts !== false) {
        messages = await enrichMailSenders(messages);
      }
      return formatListMarkdown(
        'Inbox',
        messages,
        formatMailMarkdown,
        'No messages in inbox.',
        { pagination: paginationMeta, includeTimezone: true },
      );
    } catch (error) {
      if (error instanceof SqliteMailAccessError) {
        return error.isPermissionError
          ? error.message
          : `Mail database error: ${error.message}`;
      }
      throw error;
    }
  }, 'read mail');
}

export async function handleCreateMail(
  args: MailToolArgs,
): Promise<CallToolResult> {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, CreateMailSchema);

    const recipientLines: string[] = [];

    // If replying, fetch original via JXA for full content
    let subject = validated.subject;
    let body = validated.body;
    if (validated.replyToId) {
      const jxaScript = GET_MAIL_SCRIPT_JXA.replace(
        /\{\{id\}\}/g,
        validated.replyToId,
      );
      const original = await executeJxaWithRetry<{
        id: string;
        content: string;
      } | null>(jxaScript, 10000, 'Mail');
      if (original) {
        // Get metadata from SQLite for the original message
        const meta = await getMessageById(validated.replyToId);
        if (meta) {
          if (!subject.toLowerCase().startsWith('re:')) {
            subject = `Re: ${meta.subject}`;
          }
          body = `${body}\n\n> On ${meta.dateReceived}, ${meta.sender} wrote:\n> ${original.content.split('\n').join('\n> ')}`;
        }
      }
    }

    recipientLines.push(
      ...validated.to.map(
        (addr) =>
          `msg.toRecipients.push(Mail.ToRecipient({address: "${sanitizeForJxa(addr)}"}));`,
      ),
    );

    if (validated.cc) {
      recipientLines.push(
        ...validated.cc.map(
          (addr) =>
            `msg.ccRecipients.push(Mail.CcRecipient({address: "${sanitizeForJxa(addr)}"}));`,
        ),
      );
    }

    if (validated.bcc) {
      recipientLines.push(
        ...validated.bcc.map(
          (addr) =>
            `msg.bccRecipients.push(Mail.BccRecipient({address: "${sanitizeForJxa(addr)}"}));`,
        ),
      );
    }

    const script = `
(() => {
  const Mail = Application("Mail");
  const msg = Mail.OutgoingMessage({
    subject: "${sanitizeForJxa(subject)}",
    content: "${sanitizeForJxa(body)}",
    visible: true
  });
  Mail.outgoingMessages.push(msg);
  ${recipientLines.join('\n  ')}
  return JSON.stringify({drafted: true, subject: "${sanitizeForJxa(subject)}"});
})()
`;
    await executeJxa(script, 15000, 'Mail');
    return `Successfully drafted mail "${subject}" to ${validated.to.join(', ')}.`;
  }, 'create mail draft');
}

export async function handleUpdateMail(
  args: MailToolArgs,
): Promise<CallToolResult> {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, UpdateMailSchema);
    const script = MARK_READ_SCRIPT.replace(
      /\{\{id\}\}/g,
      validated.id,
    ).replace(/\{\{readStatus\}\}/g, String(validated.read));
    await executeJxa(script, 10000, 'Mail');
    const status = validated.read ? 'read' : 'unread';
    return `Successfully marked message as ${status}.`;
  }, 'update mail');
}

export async function handleDeleteMail(
  args: MailToolArgs,
): Promise<CallToolResult> {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, DeleteMailSchema);
    const script = DELETE_MAIL_SCRIPT.replace(/\{\{id\}\}/g, validated.id);
    await executeJxa(script, 10000, 'Mail');
    return `Successfully deleted mail message with ID: "${validated.id}".`;
  }, 'delete mail');
}
