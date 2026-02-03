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
    const name = (p.name() || "").toLowerCase();
    const firstName = (p.firstName() || "").toLowerCase();
    const lastName = (p.lastName() || "").toLowerCase();
    const org = (p.organization() || "").toLowerCase();
    let emailMatch = false;
    let phoneMatch = false;
    const emails = [];
    try {
      const em = p.emails();
      for (let j = 0; j < em.length; j++) {
        const val = em[j].value();
        emails.push({ value: val, label: em[j].label() || "" });
        if (val.toLowerCase().includes(term)) emailMatch = true;
      }
    } catch(e) {}
    const phones = [];
    try {
      const ph = p.phones();
      for (let j = 0; j < ph.length; j++) {
        const val = ph[j].value();
        phones.push({ value: val, label: ph[j].label() || "" });
        if (val.includes(term)) phoneMatch = true;
      }
    } catch(e) {}
    if (name.includes(term) || firstName.includes(term) || lastName.includes(term) ||
        org.includes(term) || emailMatch || phoneMatch) {
      if (matched >= offset) {
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
  {{addEmail}}
  {{addPhone}}
  {{addAddress}}
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
  {{setFirstName}}
  {{setLastName}}
  {{setOrganization}}
  {{setJobTitle}}
  {{setNote}}
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
      search: sanitizeForJxa(validated.search),
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
      addEmail = `Contacts.Email({value: "${sanitizeForJxa(validated.email)}", label: "${sanitizeForJxa(label)}"}).pushOnto(person.emails);`;
    }

    let addPhone = '';
    if (validated.phone) {
      const label = validated.phoneLabel || 'mobile';
      addPhone = `Contacts.Phone({value: "${sanitizeForJxa(validated.phone)}", label: "${sanitizeForJxa(label)}"}).pushOnto(person.phones);`;
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
      addAddress = `Contacts.Address({
        street: "${sanitizeForJxa(validated.street || '')}",
        city: "${sanitizeForJxa(validated.city || '')}",
        state: "${sanitizeForJxa(validated.state || '')}",
        zip: "${sanitizeForJxa(validated.zip || '')}",
        country: "${sanitizeForJxa(validated.country || '')}",
        label: "${sanitizeForJxa(label)}"
      }).pushOnto(person.addresses);`;
    }

    const script = buildScript(CREATE_CONTACT_SCRIPT, {
      firstName: sanitizeForJxa(validated.firstName || ''),
      lastName: sanitizeForJxa(validated.lastName || ''),
      organization: sanitizeForJxa(validated.organization || ''),
      jobTitle: sanitizeForJxa(validated.jobTitle || ''),
      note: sanitizeForJxa(validated.note || ''),
      addEmail,
      addPhone,
      addAddress,
    });

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
    const setFirstName = validated.firstName
      ? `p.firstName = "${sanitizeForJxa(validated.firstName)}";`
      : '';
    const setLastName = validated.lastName
      ? `p.lastName = "${sanitizeForJxa(validated.lastName)}";`
      : '';
    const setOrganization = validated.organization
      ? `p.organization = "${sanitizeForJxa(validated.organization)}";`
      : '';
    const setJobTitle = validated.jobTitle
      ? `p.jobTitle = "${sanitizeForJxa(validated.jobTitle)}";`
      : '';
    const setNote =
      validated.note !== undefined
        ? `p.note = "${sanitizeForJxa(validated.note)}";`
        : '';

    const script = buildScript(UPDATE_CONTACT_SCRIPT, {
      id: validated.id,
      setFirstName,
      setLastName,
      setOrganization,
      setJobTitle,
      setNote,
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
