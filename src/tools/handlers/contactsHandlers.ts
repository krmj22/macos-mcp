/**
 * handlers/contactsHandlers.ts
 * CRUD operations for Apple Contacts via JXA
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Contact, ContactsToolArgs } from '../../types/index.js';
import { handleAsyncOperation } from '../../utils/errorHandling.js';
import {
  buildScript,
  executeJxa,
  executeJxaWithRetry,
  sanitizeForJxa,
} from '../../utils/jxaExecutor.js';
import {
  CreateContactSchema,
  DeleteContactSchema,
  ReadContactsSchema,
  SearchContactsSchema,
  UpdateContactSchema,
} from '../../validation/schemas.js';
import { extractAndValidateArgs, formatListMarkdown } from './shared.js';

// --- JXA Script Templates ---

/**
 * Bulk fetch script for contact resolver - fetches all contacts with phones/emails.
 * Limited to 10,000 contacts for safety.
 * @internal Exported for use by contactResolver.ts
 */
export const BULK_FETCH_CONTACTS_SCRIPT = `
(() => {
  const Contacts = Application("Contacts");
  const people = Contacts.people();
  const result = [];
  const limit = Math.min(people.length, 10000);
  for (let i = 0; i < limit; i++) {
    const p = people[i];
    const phones = [];
    try {
      const ph = p.phones();
      for (let j = 0; j < ph.length; j++) {
        phones.push(ph[j].value());
      }
    } catch(e) {}
    const emails = [];
    try {
      const em = p.emails();
      for (let j = 0; j < em.length; j++) {
        emails.push(em[j].value());
      }
    } catch(e) {}
    if (phones.length > 0 || emails.length > 0) {
      result.push({
        id: p.id(),
        fullName: p.name() || "",
        firstName: p.firstName() || "",
        lastName: p.lastName() || "",
        phones: phones,
        emails: emails
      });
    }
  }
  return JSON.stringify(result);
})()
`;

const LIST_CONTACTS_SCRIPT = `
(() => {
  const Contacts = Application("Contacts");
  const people = Contacts.people();
  const result = [];
  const offset = {{offset}};
  const limit = {{limit}};
  const end = Math.min(people.length, offset + limit);
  for (let i = offset; i < end; i++) {
    const p = people[i];
    const emails = [];
    try {
      const em = p.emails();
      for (let j = 0; j < em.length; j++) {
        emails.push({ value: em[j].value(), label: em[j].label() || "" });
      }
    } catch(e) {}
    const phones = [];
    try {
      const ph = p.phones();
      for (let j = 0; j < ph.length; j++) {
        phones.push({ value: ph[j].value(), label: ph[j].label() || "" });
      }
    } catch(e) {}
    result.push({
      id: p.id(),
      firstName: p.firstName() || "",
      lastName: p.lastName() || "",
      fullName: p.name() || "",
      organization: p.organization() || "",
      emails: emails,
      phones: phones,
      addresses: []
    });
  }
  return JSON.stringify(result);
})()
`;

const GET_CONTACT_SCRIPT = `
(() => {
  const Contacts = Application("Contacts");
  const people = Contacts.people.whose({id: "{{id}}"})();
  if (people.length === 0) return JSON.stringify(null);
  const p = people[0];
  const emails = [];
  try {
    const em = p.emails();
    for (let j = 0; j < em.length; j++) {
      emails.push({ value: em[j].value(), label: em[j].label() || "" });
    }
  } catch(e) {}
  const phones = [];
  try {
    const ph = p.phones();
    for (let j = 0; j < ph.length; j++) {
      phones.push({ value: ph[j].value(), label: ph[j].label() || "" });
    }
  } catch(e) {}
  const addresses = [];
  try {
    const addr = p.addresses();
    for (let j = 0; j < addr.length; j++) {
      addresses.push({
        street: addr[j].street() || "",
        city: addr[j].city() || "",
        state: addr[j].state() || "",
        zip: addr[j].zip() || "",
        country: addr[j].country() || "",
        label: addr[j].label() || ""
      });
    }
  } catch(e) {}
  return JSON.stringify({
    id: p.id(),
    firstName: p.firstName() || "",
    lastName: p.lastName() || "",
    fullName: p.name() || "",
    organization: p.organization() || "",
    jobTitle: p.jobTitle() || "",
    emails: emails,
    phones: phones,
    addresses: addresses,
    note: p.note() || "",
    birthday: p.birthDate() ? p.birthDate().toISOString() : "",
    modificationDate: p.modificationDate() ? p.modificationDate().toISOString() : ""
  });
})()
`;

const SEARCH_CONTACTS_SCRIPT = `
(() => {
  const Contacts = Application("Contacts");
  const people = Contacts.people();
  const term = "{{search}}".toLowerCase();
  const result = [];
  const offset = {{offset}};
  const limit = {{limit}};
  let matched = 0;
  for (let i = 0; i < people.length && result.length < limit; i++) {
    const p = people[i];
    // Only fetch name for initial match check (fast)
    const name = (p.name() || "").toLowerCase();
    if (name.includes(term)) {
      if (matched >= offset) {
        // Only fetch full details for matches
        const emails = [];
        try {
          const em = p.emails();
          for (let j = 0; j < em.length; j++) {
            emails.push({ value: em[j].value(), label: em[j].label() || "" });
          }
        } catch(e) {}
        const phones = [];
        try {
          const ph = p.phones();
          for (let j = 0; j < ph.length; j++) {
            phones.push({ value: ph[j].value(), label: ph[j].label() || "" });
          }
        } catch(e) {}
        result.push({
          id: p.id(),
          firstName: p.firstName() || "",
          lastName: p.lastName() || "",
          fullName: p.name() || "",
          organization: p.organization() || "",
          emails: emails,
          phones: phones,
          addresses: []
        });
      }
      matched++;
    }
  }
  return JSON.stringify(result);
})()
`;

const CREATE_CONTACT_SCRIPT = `
(() => {
  const Contacts = Application("Contacts");
  const person = Contacts.Person({
    firstName: "{{firstName}}",
    lastName: "{{lastName}}",
    organization: "{{organization}}",
    jobTitle: "{{jobTitle}}",
    note: "{{note}}"
  });
  Contacts.people.push(person);
  %%addEmail%%
  %%addPhone%%
  %%addAddress%%
  Contacts.save();
  return JSON.stringify({
    id: person.id(),
    fullName: person.name() || ""
  });
})()
`;

const UPDATE_CONTACT_SCRIPT = `
(() => {
  const Contacts = Application("Contacts");
  const people = Contacts.people.whose({id: "{{id}}"})();
  if (people.length === 0) throw new Error("Contact not found");
  const p = people[0];
  if ("{{hasFirstName}}" === "true") p.firstName = "{{firstName}}";
  if ("{{hasLastName}}" === "true") p.lastName = "{{lastName}}";
  if ("{{hasOrganization}}" === "true") p.organization = "{{organization}}";
  if ("{{hasJobTitle}}" === "true") p.jobTitle = "{{jobTitle}}";
  if ("{{hasNote}}" === "true") p.note = "{{note}}";
  Contacts.save();
  return JSON.stringify({id: p.id(), name: p.name() || ""});
})()
`;

const DELETE_CONTACT_SCRIPT = `
(() => {
  const Contacts = Application("Contacts");
  const people = Contacts.people.whose({id: "{{id}}"})();
  if (people.length === 0) throw new Error("Contact not found");
  const name = people[0].name() || "";
  Contacts.delete(people[0]);
  Contacts.save();
  return JSON.stringify({deleted: true, name: name});
})()
`;

// --- Formatting ---

function formatContactMarkdown(contact: Contact): string[] {
  const lines = [`- **${contact.fullName || 'Unnamed Contact'}**`];
  lines.push(`  - ID: ${contact.id}`);
  if (contact.organization) {
    lines.push(`  - Organization: ${contact.organization}`);
  }
  if (contact.emails.length > 0) {
    const emailStr = contact.emails
      .map((e) => (e.label ? `${e.value} (${e.label})` : e.value))
      .join(', ');
    lines.push(`  - Email: ${emailStr}`);
  }
  if (contact.phones.length > 0) {
    const phoneStr = contact.phones
      .map((p) => (p.label ? `${p.value} (${p.label})` : p.value))
      .join(', ');
    lines.push(`  - Phone: ${phoneStr}`);
  }
  return lines;
}

function formatContactDetailMarkdown(contact: Contact): string {
  const lines = [`### Contact: ${contact.fullName || 'Unnamed Contact'}`, ''];
  lines.push(`- ID: ${contact.id}`);
  if (contact.firstName) lines.push(`- First Name: ${contact.firstName}`);
  if (contact.lastName) lines.push(`- Last Name: ${contact.lastName}`);
  if (contact.organization)
    lines.push(`- Organization: ${contact.organization}`);
  if (contact.jobTitle) lines.push(`- Job Title: ${contact.jobTitle}`);

  if (contact.emails.length > 0) {
    lines.push('', '**Emails:**');
    contact.emails.forEach((e) => {
      lines.push(`- ${e.value}${e.label ? ` (${e.label})` : ''}`);
    });
  }

  if (contact.phones.length > 0) {
    lines.push('', '**Phones:**');
    contact.phones.forEach((p) => {
      lines.push(`- ${p.value}${p.label ? ` (${p.label})` : ''}`);
    });
  }

  if (contact.addresses.length > 0) {
    lines.push('', '**Addresses:**');
    contact.addresses.forEach((a) => {
      const parts = [a.street, a.city, a.state, a.zip, a.country].filter(
        Boolean,
      );
      lines.push(`- ${parts.join(', ')}${a.label ? ` (${a.label})` : ''}`);
    });
  }

  if (contact.birthday) lines.push(`- Birthday: ${contact.birthday}`);
  if (contact.note) {
    lines.push('', '**Note:**', contact.note);
  }
  if (contact.modificationDate) {
    lines.push(`- Modified: ${contact.modificationDate}`);
  }

  return lines.join('\n');
}

// --- Handlers ---

export async function handleReadContacts(
  args: ContactsToolArgs,
): Promise<CallToolResult> {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, ReadContactsSchema);

    if (validated.id) {
      const script = buildScript(GET_CONTACT_SCRIPT, { id: validated.id });
      const contact = await executeJxaWithRetry<Contact | null>(
        script,
        10000,
        'Contacts',
      );
      if (!contact) return 'Contact not found.';
      return formatContactDetailMarkdown(contact);
    }

    const paginationParams = {
      limit: String(validated.limit),
      offset: String(validated.offset),
    };
    const paginationMeta = { limit: validated.limit, offset: validated.offset };

    const script = buildScript(LIST_CONTACTS_SCRIPT, paginationParams);
    const contacts = await executeJxaWithRetry<Contact[]>(
      script,
      30000,
      'Contacts',
    );
    return formatListMarkdown(
      'Contacts',
      contacts,
      formatContactMarkdown,
      'No contacts found.',
      paginationMeta,
    );
  }, 'read contacts');
}

export async function handleSearchContacts(
  args: ContactsToolArgs,
): Promise<CallToolResult> {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, SearchContactsSchema);

    const scriptParams = {
      search: validated.search,
      limit: String(validated.limit),
      offset: String(validated.offset),
    };
    const paginationMeta = { limit: validated.limit, offset: validated.offset };

    const script = buildScript(SEARCH_CONTACTS_SCRIPT, scriptParams);
    const contacts = await executeJxaWithRetry<Contact[]>(
      script,
      30000,
      'Contacts',
    );
    return formatListMarkdown(
      `Contacts matching "${validated.search}"`,
      contacts,
      formatContactMarkdown,
      'No contacts found matching search.',
      paginationMeta,
    );
  }, 'search contacts');
}

export async function handleCreateContact(
  args: ContactsToolArgs,
): Promise<CallToolResult> {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, CreateContactSchema);

    // Build conditional script blocks
    let addEmail = '';
    if (validated.email) {
      const label = validated.emailLabel || 'work';
      addEmail = `person.emails.push(Contacts.Email({value: "${sanitizeForJxa(validated.email)}", label: "${sanitizeForJxa(label)}"}));`;
    }

    let addPhone = '';
    if (validated.phone) {
      const label = validated.phoneLabel || 'mobile';
      addPhone = `person.phones.push(Contacts.Phone({value: "${sanitizeForJxa(validated.phone)}", label: "${sanitizeForJxa(label)}"}));`;
    }

    let addAddress = '';
    if (
      validated.street ||
      validated.city ||
      validated.state ||
      validated.zip ||
      validated.country
    ) {
      const label = validated.addressLabel || 'home';
      addAddress = `person.addresses.push(Contacts.Address({
        street: "${sanitizeForJxa(validated.street || '')}",
        city: "${sanitizeForJxa(validated.city || '')}",
        state: "${sanitizeForJxa(validated.state || '')}",
        zip: "${sanitizeForJxa(validated.zip || '')}",
        country: "${sanitizeForJxa(validated.country || '')}",
        label: "${sanitizeForJxa(label)}"
      }));`;
    }

    // Build script with data fields (sanitized by buildScript)
    // Code blocks use %% placeholders to avoid double-sanitization
    let script = buildScript(CREATE_CONTACT_SCRIPT, {
      firstName: validated.firstName || '',
      lastName: validated.lastName || '',
      organization: validated.organization || '',
      jobTitle: validated.jobTitle || '',
      note: validated.note || '',
    });
    // Replace code block placeholders (not re-sanitized - they contain pre-sanitized values)
    script = script
      .replace('%%addEmail%%', addEmail)
      .replace('%%addPhone%%', addPhone)
      .replace('%%addAddress%%', addAddress);

    const result = await executeJxa<{ id: string; fullName: string }>(
      script,
      15000,
      'Contacts',
    );
    return `Successfully created contact "${result.fullName}".\n- ID: ${result.id}`;
  }, 'create contact');
}

export async function handleUpdateContact(
  args: ContactsToolArgs,
): Promise<CallToolResult> {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, UpdateContactSchema);

    // Build conditional set statements
    const script = buildScript(UPDATE_CONTACT_SCRIPT, {
      id: validated.id,
      hasFirstName: validated.firstName ? 'true' : 'false',
      firstName: validated.firstName || '',
      hasLastName: validated.lastName ? 'true' : 'false',
      lastName: validated.lastName || '',
      hasOrganization: validated.organization ? 'true' : 'false',
      organization: validated.organization || '',
      hasJobTitle: validated.jobTitle ? 'true' : 'false',
      jobTitle: validated.jobTitle || '',
      hasNote: validated.note !== undefined ? 'true' : 'false',
      note: validated.note ?? '',
    });

    const result = await executeJxa<{ id: string; name: string }>(
      script,
      10000,
      'Contacts',
    );
    return `Successfully updated contact "${result.name}".\n- ID: ${result.id}`;
  }, 'update contact');
}

export async function handleDeleteContact(
  args: ContactsToolArgs,
): Promise<CallToolResult> {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, DeleteContactSchema);
    const script = buildScript(DELETE_CONTACT_SCRIPT, { id: validated.id });
    const result = await executeJxa<{ deleted: boolean; name: string }>(
      script,
      10000,
      'Contacts',
    );
    return `Successfully deleted contact "${result.name}".\n- ID: ${validated.id}`;
  }, 'delete contact');
}
