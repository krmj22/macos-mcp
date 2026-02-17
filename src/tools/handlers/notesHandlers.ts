/**
 * handlers/notesHandlers.ts
 * CRUD operations for Apple Notes via JXA
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { NotesFoldersToolArgs, NotesToolArgs } from '../../types/index.js';
import { VALIDATION } from '../../utils/constants.js';
import { handleAsyncOperation } from '../../utils/errorHandling.js';
import {
  buildScript,
  executeJxa,
  executeJxaWithRetry,
  sanitizeForJxa,
} from '../../utils/jxaExecutor.js';
import {
  CreateNoteSchema,
  CreateNotesFolderSchema,
  DeleteNoteSchema,
  ReadNotesSchema,
  UpdateNoteSchema,
} from '../../validation/schemas.js';
import { extractAndValidateArgs, formatListMarkdown } from './shared.js';

/**
 * Escapes HTML entities in text content.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Applies inline markdown formatting to text.
 * Must be called AFTER escapeHtml() — markdown chars (*, _, ~, `) are unaffected by entity escaping.
 */
function processInline(text: string): string {
  return (
    text
      // Bold: **text** or __text__ (process before italic)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/__(.+?)__/g, '<b>$1</b>')
      // Italic: *text* or _text_
      .replace(/\*(.+?)\*/g, '<i>$1</i>')
      .replace(/_(.+?)_/g, '<i>$1</i>')
      // Strikethrough: ~~text~~
      .replace(/~~(.+?)~~/g, '<s>$1</s>')
      // Inline code: `text`
      .replace(/`(.+?)`/g, '<tt>$1</tt>')
  );
}

/**
 * Converts markdown text to HTML for Apple Notes' body property.
 * Superset of the old plainTextToHtml — plain text without markdown passes through
 * unchanged (with newlines converted to <br> and HTML entities escaped).
 *
 * Supports: headings (#, ##, ###), bold, italic, strikethrough, inline code,
 * unordered lists (-, *, +), ordered lists (1.).
 */
export function markdownToHtml(text: string): string {
  if (!text) return '';

  const lines = text.split(/\r\n|\r|\n/);
  const output: string[] = [];
  let currentListType: 'ul' | 'ol' | null = null;

  function flushList(): void {
    if (currentListType) {
      output.push(`</${currentListType}>`);
      currentListType = null;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Blank line
    if (line.trim() === '') {
      flushList();
      output.push('<br>');
      continue;
    }

    // Headings: # text, ## text, ### text
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      const content = processInline(escapeHtml(headingMatch[2]));
      output.push(`<h${level}>${content}</h${level}>`);
      continue;
    }

    // Unordered list: - text, * text, + text
    const ulMatch = line.match(/^[-*+]\s+(.+)$/);
    if (ulMatch) {
      if (currentListType !== 'ul') {
        flushList();
        output.push('<ul>');
        currentListType = 'ul';
      }
      output.push(`<li>${processInline(escapeHtml(ulMatch[1]))}</li>`);
      continue;
    }

    // Ordered list: 1. text
    const olMatch = line.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      if (currentListType !== 'ol') {
        flushList();
        output.push('<ol>');
        currentListType = 'ol';
      }
      output.push(`<li>${processInline(escapeHtml(olMatch[1]))}</li>`);
      continue;
    }

    // Regular text line
    flushList();
    // Add <br> between consecutive regular text lines
    if (output.length > 0) {
      const last = output[output.length - 1];
      // Only add <br> if previous output was also a regular text line (not a block element)
      if (
        last &&
        !last.startsWith('<h') &&
        !last.startsWith('</') &&
        !last.startsWith('<ul') &&
        !last.startsWith('<ol') &&
        !last.startsWith('<li') &&
        last !== '<br>'
      ) {
        output.push('<br>');
      }
    }
    output.push(processInline(escapeHtml(line)));
  }

  flushList();
  return output.join('');
}

interface NoteItem {
  id: string;
  name: string;
  body: string;
  folder: string;
  creationDate: string;
  modificationDate: string;
}

// --- JXA Script Templates ---

const LIST_NOTES_SCRIPT = `
(() => {
  const Notes = Application("Notes");
  const folders = Notes.folders();
  const result = [];
  const offset = {{offset}};
  const limit = {{limit}};
  let skipped = 0;
  for (let fi = 0; fi < folders.length && result.length < limit; fi++) {
    const f = folders[fi];
    if (f.name() === "Recently Deleted") continue;
    const notes = f.notes();
    for (let ni = 0; ni < notes.length && result.length < limit; ni++) {
      if (skipped < offset) { skipped++; continue; }
      const n = notes[ni];
      result.push({
        id: n.id(),
        name: n.name(),
        body: "",
        folder: f.name(),
        creationDate: n.creationDate().toISOString(),
        modificationDate: n.modificationDate().toISOString()
      });
    }
  }
  return JSON.stringify(result);
})()
`;

const SEARCH_NOTES_SCRIPT = `
(() => {
  const Notes = Application("Notes");
  const term = "{{search}}";
  // whose() for title matches (indexed, fast), then plaintext() only on matches
  const titleMatches = Notes.notes.whose({name: {_contains: term}})();
  const result = [];
  const offset = {{offset}};
  const limit = {{limit}};
  let skipped = 0;
  for (let i = 0; i < titleMatches.length && result.length < limit; i++) {
    const n = titleMatches[i];
    if (n.container().name() === "Recently Deleted") continue;
    if (skipped < offset) { skipped++; continue; }
    result.push({
      id: n.id(),
      name: n.name(),
      body: n.plaintext().substring(0, 500),
      folder: n.container().name(),
      creationDate: n.creationDate().toISOString(),
      modificationDate: n.modificationDate().toISOString()
    });
  }
  return JSON.stringify(result);
})()
`;

const GET_NOTE_SCRIPT = `
(() => {
  const Notes = Application("Notes");
  const notes = Notes.notes.whose({id: "{{id}}"})();
  if (notes.length === 0) return JSON.stringify(null);
  const n = notes[0];
  return JSON.stringify({
    id: n.id(),
    name: n.name(),
    body: n.plaintext(),
    folder: n.container().name(),
    creationDate: n.creationDate().toISOString(),
    modificationDate: n.modificationDate().toISOString()
  });
})()
`;

const CREATE_NOTE_SCRIPT = `
(() => {
  const Notes = Application("Notes");
  const folder = Notes.folders.whose({name: "{{folder}}"})();
  const target = folder.length > 0 ? folder[0] : Notes.defaultAccount().defaultFolder();
  const note = Notes.Note({name: "{{title}}", body: "{{body}}"});
  target.notes.push(note);
  return JSON.stringify({id: note.id(), name: note.name()});
})()
`;

const UPDATE_NOTE_SCRIPT = `
(() => {
  const Notes = Application("Notes");
  const notes = Notes.notes.whose({id: "{{id}}"})();
  if (notes.length === 0) throw new Error("Note not found");
  const n = notes[0];
  const titleToSet = "{{hasName}}" === "true" ? "{{newName}}" : n.name();
  if ("{{hasBody}}" === "true") n.body = "{{newBody}}";
  n.name = titleToSet;
  %%moveToFolder%%
  return JSON.stringify({id: n.id(), name: n.name(), folder: n.container().name()});
})()
`;

const APPEND_NOTE_SCRIPT = `
(() => {
  const Notes = Application("Notes");
  const notes = Notes.notes.whose({id: "{{id}}"})();
  if (notes.length === 0) throw new Error("Note not found");
  const n = notes[0];
  const titleToSet = "{{hasName}}" === "true" ? "{{newName}}" : n.name();
  const existingPlain = n.plaintext();
  if (existingPlain.length + {{rawNewBodyLength}} + 1 > {{maxBodyLength}}) throw new Error("Combined note body exceeds {{maxBodyLength}} characters (existing: " + existingPlain.length + " + new: " + {{rawNewBodyLength}} + ")");
  const existingHtml = n.body();
  n.body = existingHtml + "<br>" + "{{newBody}}";
  n.name = titleToSet;
  %%moveToFolder%%
  return JSON.stringify({id: n.id(), name: n.name(), folder: n.container().name()});
})()
`;

const DELETE_NOTE_SCRIPT = `
(() => {
  const Notes = Application("Notes");
  const notes = Notes.notes.whose({id: "{{id}}"})();
  if (notes.length === 0) throw new Error("Note not found");
  Notes.delete(notes[0]);
  return JSON.stringify({deleted: true});
})()
`;

const LIST_NOTES_BY_FOLDER_SCRIPT = `
(() => {
  const Notes = Application("Notes");
  const folders = Notes.folders.whose({name: "{{folder}}"})();
  if (folders.length === 0) return JSON.stringify([]);
  const notes = folders[0].notes();
  const result = [];
  const offset = {{offset}};
  const limit = {{limit}};
  const end = Math.min(notes.length, offset + limit);
  for (let i = offset; i < end; i++) {
    const n = notes[i];
    result.push({
      id: n.id(),
      name: n.name(),
      body: "",
      folder: "{{folder}}",
      creationDate: n.creationDate().toISOString(),
      modificationDate: n.modificationDate().toISOString()
    });
  }
  return JSON.stringify(result);
})()
`;

const LIST_FOLDERS_SCRIPT = `
(() => {
  const Notes = Application("Notes");
  const folders = Notes.folders();
  const result = [];
  for (let i = 0; i < folders.length; i++) {
    const f = folders[i];
    result.push({
      name: f.name(),
      noteCount: f.notes().length
    });
  }
  return JSON.stringify(result);
})()
`;

const CREATE_FOLDER_SCRIPT = `
(() => {
  const Notes = Application("Notes");
  const folder = Notes.Folder({name: "{{name}}"});
  Notes.folders.push(folder);
  return JSON.stringify({name: folder.name()});
})()
`;

interface FolderItem {
  name: string;
  noteCount: number;
}

// --- Formatting ---

function formatNoteMarkdown(note: NoteItem): string[] {
  const lines = [`- **${note.name}**`];
  lines.push(`  - ID: ${note.id}`);
  lines.push(`  - Folder: ${note.folder}`);
  if (note.body) {
    const preview = note.body.substring(0, 200).replace(/\n/g, ' ');
    lines.push(`  - Preview: ${preview}${note.body.length > 200 ? '...' : ''}`);
  }
  lines.push(`  - Modified: ${note.modificationDate}`);
  return lines;
}

// --- Handlers ---

export async function handleReadNotes(
  args: NotesToolArgs,
): Promise<CallToolResult> {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, ReadNotesSchema);

    if (validated.id) {
      const script = buildScript(GET_NOTE_SCRIPT, { id: validated.id });
      const note = await executeJxaWithRetry<NoteItem | null>(
        script,
        10000,
        'Notes',
      );
      if (!note) return 'Note not found.';
      return [
        `### Note: ${note.name}`,
        '',
        `- ID: ${note.id}`,
        `- Folder: ${note.folder}`,
        `- Created: ${note.creationDate}`,
        `- Modified: ${note.modificationDate}`,
        '',
        '**Content:**',
        note.body,
      ].join('\n');
    }

    const paginationParams = {
      limit: String(validated.limit),
      offset: String(validated.offset),
    };
    const paginationMeta = { limit: validated.limit, offset: validated.offset };

    if (validated.folder) {
      const script = buildScript(LIST_NOTES_BY_FOLDER_SCRIPT, {
        folder: validated.folder,
        ...paginationParams,
      });
      const notes = await executeJxaWithRetry<NoteItem[]>(
        script,
        30000,
        'Notes',
      );
      return formatListMarkdown(
        `Notes in "${validated.folder}"`,
        notes,
        formatNoteMarkdown,
        `No notes found in folder "${validated.folder}".`,
        paginationMeta,
      );
    }

    if (validated.search) {
      const script = buildScript(SEARCH_NOTES_SCRIPT, {
        search: validated.search,
        ...paginationParams,
      });
      const notes = await executeJxaWithRetry<NoteItem[]>(
        script,
        30000,
        'Notes',
      );
      return formatListMarkdown(
        `Notes matching "${validated.search}"`,
        notes,
        formatNoteMarkdown,
        'No notes found matching search.',
        paginationMeta,
      );
    }

    const script = buildScript(LIST_NOTES_SCRIPT, paginationParams);
    const notes = await executeJxaWithRetry<NoteItem[]>(script, 30000, 'Notes');
    return formatListMarkdown(
      'Notes',
      notes,
      formatNoteMarkdown,
      'No notes found.',
      paginationMeta,
    );
  }, 'read notes');
}

export async function handleCreateNote(
  args: NotesToolArgs,
): Promise<CallToolResult> {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, CreateNoteSchema);
    const script = buildScript(CREATE_NOTE_SCRIPT, {
      title: validated.title,
      body: markdownToHtml(validated.body ?? ''),
      folder: validated.folder ?? 'Notes',
    });
    const result = await executeJxa<{ id: string; name: string }>(
      script,
      10000,
      'Notes',
    );
    return `Successfully created note "${result.name}".\n- ID: ${result.id}`;
  }, 'create note');
}

export async function handleUpdateNote(
  args: NotesToolArgs,
): Promise<CallToolResult> {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, UpdateNoteSchema);
    const moveToFolder = validated.targetFolder
      ? `const targetFolder = Notes.folders.whose({name: "${sanitizeForJxa(validated.targetFolder)}"})()[0]; if (!targetFolder) throw new Error("Folder not found: ${sanitizeForJxa(validated.targetFolder)}"); n.move({to: targetFolder});`
      : '';

    const useAppend = validated.append === true && validated.body !== undefined;
    const scriptTemplate = useAppend ? APPEND_NOTE_SCRIPT : UPDATE_NOTE_SCRIPT;

    const scriptParams: Record<string, string> = {
      id: validated.id,
      hasName: validated.title ? 'true' : 'false',
      newName: validated.title ?? '',
    };

    if (useAppend) {
      scriptParams.newBody = markdownToHtml(validated.body ?? '');
      scriptParams.rawNewBodyLength = String((validated.body ?? '').length);
      scriptParams.maxBodyLength = String(VALIDATION.MAX_NOTE_LENGTH);
    } else {
      scriptParams.hasBody = validated.body !== undefined ? 'true' : 'false';
      scriptParams.newBody = markdownToHtml(validated.body ?? '');
    }

    // Build script with data fields (sanitized by buildScript)
    // moveToFolder uses %% placeholder to avoid double-sanitization (contains pre-sanitized JXA code)
    const script = buildScript(scriptTemplate, scriptParams).replace(
      '%%moveToFolder%%',
      moveToFolder,
    );
    const result = await executeJxa<{
      id: string;
      name: string;
      folder: string;
    }>(script, 10000, 'Notes');
    const folderInfo = validated.targetFolder
      ? `\n- Folder: ${result.folder}`
      : '';
    const appendInfo = useAppend ? ' (appended)' : '';
    return `Successfully updated note "${result.name}"${appendInfo}.\n- ID: ${result.id}${folderInfo}`;
  }, 'update note');
}

export async function handleDeleteNote(
  args: NotesToolArgs,
): Promise<CallToolResult> {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, DeleteNoteSchema);
    const script = buildScript(DELETE_NOTE_SCRIPT, { id: validated.id });
    await executeJxa(script, 10000, 'Notes');
    return `Successfully deleted note with ID: "${validated.id}". (Moved to Recently Deleted)`;
  }, 'delete note');
}

// --- Folder Handlers ---

function formatFolderMarkdown(folder: FolderItem): string[] {
  return [`- **${folder.name}**`, `  - Notes: ${folder.noteCount}`];
}

export async function handleReadNotesFolders(
  _args?: NotesFoldersToolArgs,
): Promise<CallToolResult> {
  return handleAsyncOperation(async () => {
    const folders = await executeJxaWithRetry<FolderItem[]>(
      LIST_FOLDERS_SCRIPT,
      15000,
      'Notes',
    );
    return formatListMarkdown(
      'Note Folders',
      folders,
      formatFolderMarkdown,
      'No folders found.',
    );
  }, 'read note folders');
}

export async function handleCreateNotesFolder(
  args: NotesFoldersToolArgs,
): Promise<CallToolResult> {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, CreateNotesFolderSchema);
    const script = buildScript(CREATE_FOLDER_SCRIPT, { name: validated.name });
    const result = await executeJxa<{ name: string }>(script, 10000, 'Notes');
    return `Successfully created folder "${result.name}".`;
  }, 'create note folder');
}
