/**
 * handlers/mailHandlers.ts
 * CRUD operations for Apple Mail via JXA
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { MailToolArgs } from '../../types/index.js';
import { handleAsyncOperation } from '../../utils/errorHandling.js';
import {
  buildScript,
  executeJxa,
  executeJxaWithRetry,
  sanitizeForJxa,
} from '../../utils/jxaExecutor.js';
import {
  CreateMailSchema,
  DeleteMailSchema,
  ReadMailSchema,
  UpdateMailSchema,
} from '../../validation/schemas.js';
import { extractAndValidateArgs, formatListMarkdown } from './shared.js';

interface MailMessage {
  id: string;
  subject: string;
  sender: string;
  dateReceived: string;
  read: boolean;
  mailbox: string;
  account: string;
  preview: string;
}

interface MailMessageFull extends MailMessage {
  content: string;
  toRecipients: string[];
  ccRecipients: string[];
}

interface MailboxItem {
  name: string;
  account: string;
  unreadCount: number;
}

// --- JXA Script Templates ---

const LIST_MAIL_SCRIPT = `
(() => {
  const Mail = Application("Mail");
  const inbox = Mail.inbox();
  const msgs = inbox.messages();
  const result = [];
  const offset = {{offset}};
  const limit = {{limit}};
  const end = Math.min(msgs.length, offset + limit);
  for (let i = offset; i < end; i++) {
    const m = msgs[i];
    result.push({
      id: m.id().toString(),
      subject: m.subject() || "(no subject)",
      sender: m.sender(),
      dateReceived: m.dateReceived().toISOString(),
      read: m.readStatus(),
      mailbox: "Inbox",
      account: m.mailbox().account().name(),
      preview: (m.content() || "").substring(0, 200)
    });
  }
  return JSON.stringify(result);
})()
`;

const LIST_MAILBOXES_SCRIPT = `
(() => {
  const Mail = Application("Mail");
  const accounts = Mail.accounts();
  const result = [];
  for (let a = 0; a < accounts.length; a++) {
    const acc = accounts[a];
    const mailboxes = acc.mailboxes();
    for (let b = 0; b < mailboxes.length; b++) {
      const mb = mailboxes[b];
      result.push({
        name: mb.name(),
        account: acc.name(),
        unreadCount: mb.unreadCount()
      });
    }
  }
  return JSON.stringify(result);
})()
`;

const LIST_MAILBOX_SCRIPT = `
(() => {
  const Mail = Application("Mail");
  const accounts = Mail.accounts();
  const targetAccount = "{{account}}";
  const targetMailbox = "{{mailbox}}";
  const result = [];
  const offset = {{offset}};
  const limit = {{limit}};
  for (let a = 0; a < accounts.length; a++) {
    if (targetAccount && accounts[a].name() !== targetAccount) continue;
    const mailboxes = accounts[a].mailboxes();
    for (let b = 0; b < mailboxes.length; b++) {
      if (mailboxes[b].name() !== targetMailbox) continue;
      const msgs = mailboxes[b].messages();
      const end = Math.min(msgs.length, offset + limit);
      for (let i = offset; i < end; i++) {
        const m = msgs[i];
        result.push({
          id: m.id().toString(),
          subject: m.subject() || "(no subject)",
          sender: m.sender(),
          dateReceived: m.dateReceived().toISOString(),
          read: m.readStatus(),
          mailbox: targetMailbox,
          account: accounts[a].name(),
          preview: (m.content() || "").substring(0, 200)
        });
      }
      return JSON.stringify(result);
    }
  }
  return JSON.stringify(result);
})()
`;

const SEARCH_MAIL_SCRIPT = `
(() => {
  const Mail = Application("Mail");
  const inbox = Mail.inbox();
  const msgs = inbox.messages();
  const term = "{{search}}".toLowerCase();
  const result = [];
  const offset = {{offset}};
  const limit = {{limit}};
  let matched = 0;
  for (let i = 0; i < msgs.length && result.length < limit; i++) {
    const m = msgs[i];
    const subj = m.subject() || "";
    const sender = m.sender() || "";
    const content = m.content() || "";
    if (subj.toLowerCase().includes(term) || sender.toLowerCase().includes(term) || content.toLowerCase().includes(term)) {
      if (matched >= offset) {
        result.push({
          id: m.id().toString(),
          subject: subj || "(no subject)",
          sender: sender,
          dateReceived: m.dateReceived().toISOString(),
          read: m.readStatus(),
          mailbox: "Inbox",
          account: m.mailbox().account().name(),
          preview: (content).substring(0, 200)
        });
      }
      matched++;
    }
  }
  return JSON.stringify(result);
})()
`;

const GET_MAIL_SCRIPT = `
(() => {
  const Mail = Application("Mail");
  const accounts = Mail.accounts();
  for (let a = 0; a < accounts.length; a++) {
    const mailboxes = accounts[a].mailboxes();
    for (let b = 0; b < mailboxes.length; b++) {
      const msgs = mailboxes[b].messages.whose({id: {{id}}})();
      if (msgs.length > 0) {
        const m = msgs[0];
        const to = m.toRecipients().map(r => r.address());
        const cc = m.ccRecipients().map(r => r.address());
        return JSON.stringify({
          id: m.id().toString(),
          subject: m.subject() || "(no subject)",
          sender: m.sender(),
          dateReceived: m.dateReceived().toISOString(),
          read: m.readStatus(),
          mailbox: mailboxes[b].name(),
          account: accounts[a].name(),
          content: m.content() || "",
          toRecipients: to,
          ccRecipients: cc,
          preview: ""
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
  const lines = [`- **${msg.subject}**${status}`];
  lines.push(`  - ID: ${msg.id}`);
  lines.push(`  - From: ${msg.sender}`);
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

    if (validated.id) {
      const script = buildScript(GET_MAIL_SCRIPT, { id: validated.id });
      const msg = await executeJxaWithRetry<MailMessageFull | null>(
        script,
        10000,
        'Mail',
      );
      if (!msg) return 'Mail message not found.';
      return [
        `### Mail: ${msg.subject}`,
        '',
        `- ID: ${msg.id}`,
        `- From: ${msg.sender}`,
        `- To: ${msg.toRecipients.join(', ')}`,
        msg.ccRecipients.length > 0
          ? `- CC: ${msg.ccRecipients.join(', ')}`
          : null,
        `- Date: ${msg.dateReceived}`,
        `- Mailbox: ${msg.mailbox}`,
        `- Account: ${msg.account}`,
        '',
        '**Content:**',
        msg.content,
      ]
        .filter(Boolean)
        .join('\n');
    }

    const paginationParams = {
      limit: String(validated.limit),
      offset: String(validated.offset),
    };
    const paginationMeta = { limit: validated.limit, offset: validated.offset };

    // List mailboxes
    if (validated.mailbox === '_list') {
      const mailboxes = await executeJxaWithRetry<MailboxItem[]>(
        LIST_MAILBOXES_SCRIPT,
        15000,
        'Mail',
      );
      return formatListMarkdown(
        'Mailboxes',
        mailboxes,
        formatMailboxMarkdown,
        'No mailboxes found.',
      );
    }

    // Read from specific mailbox
    if (validated.mailbox) {
      const script = buildScript(LIST_MAILBOX_SCRIPT, {
        mailbox: validated.mailbox,
        account: validated.account ?? '',
        ...paginationParams,
      });
      const messages = await executeJxaWithRetry<MailMessage[]>(
        script,
        30000,
        'Mail',
      );
      return formatListMarkdown(
        `Mailbox: ${validated.mailbox}`,
        messages,
        formatMailMarkdown,
        'No messages in this mailbox.',
        paginationMeta,
      );
    }

    if (validated.search) {
      const script = buildScript(SEARCH_MAIL_SCRIPT, {
        search: validated.search,
        ...paginationParams,
      });
      const messages = await executeJxaWithRetry<MailMessage[]>(
        script,
        30000,
        'Mail',
      );
      return formatListMarkdown(
        `Mail matching "${validated.search}"`,
        messages,
        formatMailMarkdown,
        'No messages found matching search.',
        paginationMeta,
      );
    }

    const script = buildScript(LIST_MAIL_SCRIPT, paginationParams);
    const messages = await executeJxaWithRetry<MailMessage[]>(
      script,
      30000,
      'Mail',
    );
    return formatListMarkdown(
      'Inbox',
      messages,
      formatMailMarkdown,
      'No messages in inbox.',
      paginationMeta,
    );
  }, 'read mail');
}

export async function handleCreateMail(
  args: MailToolArgs,
): Promise<CallToolResult> {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, CreateMailSchema);

    // Build recipient lines
    const recipientLines: string[] = [];

    // If replying, fetch original and build reply
    let subject = validated.subject;
    let body = validated.body;
    if (validated.replyToId) {
      const getScript = buildScript(GET_MAIL_SCRIPT, {
        id: validated.replyToId,
      });
      const original = await executeJxaWithRetry<MailMessageFull | null>(
        getScript,
        10000,
        'Mail',
      );
      if (original) {
        if (!subject.toLowerCase().startsWith('re:')) {
          subject = `Re: ${original.subject}`;
        }
        body = `${body}\n\n> On ${original.dateReceived}, ${original.sender} wrote:\n> ${original.content.split('\n').join('\n> ')}`;
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

    // Build script manually to avoid double-escaping the recipient code
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
    const script = buildScript(MARK_READ_SCRIPT, {
      id: validated.id,
      readStatus: String(validated.read),
    });
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
    const script = buildScript(DELETE_MAIL_SCRIPT, { id: validated.id });
    await executeJxa(script, 10000, 'Mail');
    return `Successfully deleted mail message with ID: "${validated.id}".`;
  }, 'delete mail');
}
