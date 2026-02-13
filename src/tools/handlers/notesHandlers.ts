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
  const existing = n.plaintext();
  const combined = existing + "\\n" + "{{newBody}}";
  if (combined.length > {{maxBodyLength}}) throw new Error("Combined note body exceeds {{maxBodyLength}} characters (existing: " + existing.length + " + new: " + "{{newBody}}".length + " = " + combined.length + ")");
  n.body = combined;
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
      body: validated.body ?? '',
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
      scriptParams.newBody = validated.body ?? '';
      scriptParams.maxBodyLength = String(VALIDATION.MAX_NOTE_LENGTH);
    } else {
      scriptParams.hasBody = validated.body !== undefined ? 'true' : 'false';
      scriptParams.newBody = validated.body ?? '';
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
