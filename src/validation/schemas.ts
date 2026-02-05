/**
 * @fileoverview Comprehensive input validation schemas using Zod for security
 * @module validation/schemas
 * @description Security-focused validation with safe text patterns, URL validation,
 * and length limits to prevent injection attacks and malformed data
 */

import { z } from 'zod/v3';
import { VALIDATION } from '../utils/constants.js';

// Security patterns – allow printable Unicode text while blocking dangerous control and delimiter chars.
// Allows standard printable ASCII, extended Latin, CJK, plus newlines/tabs for notes.
// Blocks: control chars (0x00-0x1F except \n\r\t), DEL, dangerous delimiters, Unicode line separators
// This keeps Chinese/Unicode names working while remaining safe with AppleScript quoting.
const SAFE_TEXT_PATTERN = /^[\u0020-\u007E\u00A0-\uFFFF\n\r\t]*$/u;
// Support multiple date formats: YYYY-MM-DD, YYYY-MM-DD HH:mm:ss, or ISO 8601
// Basic validation - detailed parsing handled by Swift
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}.*$/;
// URL validation that blocks internal/private network addresses and localhost
// Prevents SSRF attacks while allowing legitimate external URLs
const URL_PATTERN =
  /^https?:\/\/(?!(?:127\.|192\.168\.|10\.|localhost|0\.0\.0\.0))[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*(?:\/[^\s<>"{}|\\^`[\]]*)?$/i;

// Maximum lengths for security (imported from constants.ts)

/**
 * Schema factory for required safe text validation
 * @param {number} minLength - Minimum character length
 * @param {number} maxLength - Maximum character length
 * @param {string} [fieldName='Text'] - Field name for error messages
 * @returns {ZodString} Validated string schema with security patterns
 * @description
 * - Blocks control characters and dangerous Unicode
 * - Allows printable ASCII, extended Latin, CJK characters
 * - Enforces length limits for security
 */
const createSafeTextSchema = (
  minLength: number,
  maxLength: number,
  fieldName = 'Text',
) =>
  z
    .string()
    .min(minLength, `${fieldName} cannot be empty`)
    .max(maxLength, `${fieldName} cannot exceed ${maxLength} characters`)
    .regex(
      SAFE_TEXT_PATTERN,
      `${fieldName} contains invalid characters. Only alphanumeric, spaces, and basic punctuation allowed`,
    );

/**
 * Schema factory for optional safe text validation
 * @param {number} maxLength - Maximum character length
 * @param {string} [fieldName='Text'] - Field name for error messages
 * @returns {ZodOptional<ZodString>} Optional validated string schema
 * @description Same security patterns as createSafeTextSchema but allows undefined values
 */
const createOptionalSafeTextSchema = (maxLength: number, fieldName = 'Text') =>
  z
    .string()
    .max(maxLength, `${fieldName} cannot exceed ${maxLength} characters`)
    .regex(SAFE_TEXT_PATTERN, `${fieldName} contains invalid characters`)
    .optional();

/**
 * Base validation schemas using factory functions
 */
export const SafeTextSchema = createSafeTextSchema(
  1,
  VALIDATION.MAX_TITLE_LENGTH,
);
export const SafeNoteSchema = createOptionalSafeTextSchema(
  VALIDATION.MAX_NOTE_LENGTH,
  'Note',
);
export const SafeListNameSchema = createOptionalSafeTextSchema(
  VALIDATION.MAX_LIST_NAME_LENGTH,
  'List name',
);
export const RequiredListNameSchema = createSafeTextSchema(
  1,
  VALIDATION.MAX_LIST_NAME_LENGTH,
  'List name',
);
export const SafeSearchSchema = createOptionalSafeTextSchema(
  VALIDATION.MAX_SEARCH_LENGTH,
  'Search term',
);

export const SafeDateSchema = z
  .string()
  .regex(
    DATE_PATTERN,
    "Date must be in format 'YYYY-MM-DD', 'YYYY-MM-DD HH:mm:ss', or ISO 8601 (e.g., '2025-10-30T04:00:00Z')",
  )
  .optional();

/**
 * Creates a required date schema with validation
 */
const createRequiredDateSchema = (fieldName: string) =>
  z
    .string()
    .regex(
      DATE_PATTERN,
      `${fieldName} must be in format 'YYYY-MM-DD', 'YYYY-MM-DD HH:mm:ss', or ISO 8601`,
    )
    .min(1, `${fieldName} is required`);

export const SafeUrlSchema = z
  .string()
  .regex(URL_PATTERN, 'URL must be a valid HTTP or HTTPS URL')
  .max(
    VALIDATION.MAX_URL_LENGTH,
    `URL cannot exceed ${VALIDATION.MAX_URL_LENGTH} characters`,
  )
  .optional();

// Reusable schemas for common fields
const DueWithinEnum = z
  .enum(['today', 'tomorrow', 'this-week', 'overdue', 'no-date'])
  .optional();

/**
 * Common field combinations for reusability
 */
const BaseReminderFields = {
  title: SafeTextSchema,
  dueDate: SafeDateSchema,
  note: SafeNoteSchema,
  url: SafeUrlSchema,
  targetList: SafeListNameSchema,
};

export const SafeIdSchema = z.string().min(1, 'ID cannot be empty');

/**
 * Tool-specific validation schemas
 */
export const CreateReminderSchema = z.object(BaseReminderFields);

export const ReadRemindersSchema = z.object({
  id: SafeIdSchema.optional(),
  filterList: SafeListNameSchema,
  showCompleted: z.boolean().optional().default(false),
  search: SafeSearchSchema,
  dueWithin: DueWithinEnum,
});

export const UpdateReminderSchema = z.object({
  id: SafeIdSchema,
  title: SafeTextSchema.optional(),
  dueDate: SafeDateSchema,
  note: SafeNoteSchema,
  url: SafeUrlSchema,
  completed: z.boolean().optional(),
  targetList: SafeListNameSchema,
});

export const DeleteReminderSchema = z.object({
  id: SafeIdSchema,
});

// Recurrence schema
export const RecurrenceSchema = z
  .object({
    frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    interval: z.number().int().min(1).max(99).optional().default(1),
    endDate: SafeDateSchema,
    occurrenceCount: z.number().int().min(1).max(999).optional(),
  })
  .refine((data) => !(data.endDate && data.occurrenceCount), {
    message: 'Specify either endDate or occurrenceCount, not both',
  });

// Calendar event schemas
export const CreateCalendarEventSchema = z.object({
  title: SafeTextSchema,
  startDate: createRequiredDateSchema('Start date'),
  endDate: createRequiredDateSchema('End date'),
  note: SafeNoteSchema,
  location: createOptionalSafeTextSchema(
    VALIDATION.MAX_LOCATION_LENGTH,
    'Location',
  ),
  url: SafeUrlSchema,
  isAllDay: z.boolean().optional(),
  targetCalendar: SafeListNameSchema,
  recurrence: z.enum(['daily', 'weekly', 'monthly', 'yearly']).optional(),
  recurrenceInterval: z.number().int().min(1).max(99).optional(),
  recurrenceEnd: SafeDateSchema,
  recurrenceCount: z.number().int().min(1).max(999).optional(),
});

export const ReadCalendarEventsSchema = z.object({
  id: SafeIdSchema.optional(),
  filterCalendar: SafeListNameSchema,
  search: SafeSearchSchema,
  startDate: SafeDateSchema,
  endDate: SafeDateSchema,
  enrichContacts: z.boolean().optional().default(true),
});

export const UpdateCalendarEventSchema = z.object({
  id: SafeIdSchema,
  title: SafeTextSchema.optional(),
  startDate: SafeDateSchema,
  endDate: SafeDateSchema,
  note: SafeNoteSchema,
  location: createOptionalSafeTextSchema(
    VALIDATION.MAX_LOCATION_LENGTH,
    'Location',
  ),
  url: SafeUrlSchema,
  isAllDay: z.boolean().optional(),
  targetCalendar: SafeListNameSchema,
  recurrence: z.enum(['daily', 'weekly', 'monthly', 'yearly']).optional(),
  recurrenceInterval: z.number().int().min(1).max(99).optional(),
  recurrenceEnd: SafeDateSchema,
  recurrenceCount: z.number().int().min(1).max(999).optional(),
});

export const DeleteCalendarEventSchema = z.object({
  id: SafeIdSchema,
});

export const ReadCalendarsSchema = z.object({});

export const CreateReminderListSchema = z.object({
  name: RequiredListNameSchema,
});

export const UpdateReminderListSchema = z.object({
  name: RequiredListNameSchema,
  newName: RequiredListNameSchema,
});

export const DeleteReminderListSchema = z.object({
  name: RequiredListNameSchema,
});

// --- Notes Schemas ---

const PaginationFields = {
  limit: z.number().int().min(1).max(200).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
};

export const ReadNotesSchema = z.object({
  id: SafeIdSchema.optional(),
  search: SafeSearchSchema,
  folder: SafeListNameSchema,
  ...PaginationFields,
});

export const CreateNoteSchema = z.object({
  title: SafeTextSchema,
  body: SafeNoteSchema,
  folder: SafeListNameSchema,
});

export const UpdateNoteSchema = z.object({
  id: SafeIdSchema,
  title: SafeTextSchema.optional(),
  body: SafeNoteSchema,
  targetFolder: SafeListNameSchema,
});

export const DeleteNoteSchema = z.object({
  id: SafeIdSchema,
});

export const ReadNotesFoldersSchema = z.object({});

export const CreateNotesFolderSchema = z.object({
  name: RequiredListNameSchema,
});

// --- Mail Schemas ---

export const ReadMailSchema = z.object({
  id: z.string().optional(),
  search: SafeSearchSchema,
  mailbox: createOptionalSafeTextSchema(
    VALIDATION.MAX_LIST_NAME_LENGTH,
    'Mailbox',
  ),
  account: createOptionalSafeTextSchema(
    VALIDATION.MAX_LIST_NAME_LENGTH,
    'Account',
  ),
  enrichContacts: z.boolean().optional().default(true),
  contact: createOptionalSafeTextSchema(
    VALIDATION.MAX_TITLE_LENGTH,
    'Contact name',
  ),
  ...PaginationFields,
});

export const CreateMailSchema = z.object({
  subject: SafeTextSchema,
  body: z.string().max(10000, 'Body cannot exceed 10000 characters'),
  to: z.array(z.string().email()).min(1, 'At least one recipient required'),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  replyToId: z.string().optional(),
});

export const UpdateMailSchema = z.object({
  id: SafeIdSchema,
  read: z.boolean(),
});

export const DeleteMailSchema = z.object({
  id: SafeIdSchema,
});

// --- Messages Schemas ---

export const ReadMessagesSchema = z.object({
  chatId: z.string().optional(),
  search: SafeSearchSchema,
  searchMessages: z.boolean().optional(),
  enrichContacts: z.boolean().optional().default(true),
  contact: createOptionalSafeTextSchema(
    VALIDATION.MAX_TITLE_LENGTH,
    'Contact name',
  ),
  ...PaginationFields,
});

export const CreateMessageSchema = z.object({
  text: z.string().min(1, 'Message text cannot be empty').max(10000),
  to: z.string().optional(),
  chatId: z.string().optional(),
});

// --- Contacts Schemas ---

export const ReadContactsSchema = z.object({
  id: SafeIdSchema.optional(),
  ...PaginationFields,
});

export const SearchContactsSchema = z.object({
  search: z
    .string()
    .min(1, 'Search term is required')
    .max(VALIDATION.MAX_SEARCH_LENGTH),
  ...PaginationFields,
});

export const CreateContactSchema = z
  .object({
    firstName: createOptionalSafeTextSchema(
      VALIDATION.MAX_TITLE_LENGTH,
      'First name',
    ),
    lastName: createOptionalSafeTextSchema(
      VALIDATION.MAX_TITLE_LENGTH,
      'Last name',
    ),
    organization: createOptionalSafeTextSchema(
      VALIDATION.MAX_TITLE_LENGTH,
      'Organization',
    ),
    jobTitle: createOptionalSafeTextSchema(
      VALIDATION.MAX_TITLE_LENGTH,
      'Job title',
    ),
    email: z.string().email('Invalid email format').optional(),
    emailLabel: createOptionalSafeTextSchema(50, 'Email label'),
    phone: createOptionalSafeTextSchema(50, 'Phone'),
    phoneLabel: createOptionalSafeTextSchema(50, 'Phone label'),
    street: createOptionalSafeTextSchema(
      VALIDATION.MAX_LOCATION_LENGTH,
      'Street',
    ),
    city: createOptionalSafeTextSchema(VALIDATION.MAX_LIST_NAME_LENGTH, 'City'),
    state: createOptionalSafeTextSchema(
      VALIDATION.MAX_LIST_NAME_LENGTH,
      'State',
    ),
    zip: createOptionalSafeTextSchema(20, 'ZIP code'),
    country: createOptionalSafeTextSchema(
      VALIDATION.MAX_LIST_NAME_LENGTH,
      'Country',
    ),
    addressLabel: createOptionalSafeTextSchema(50, 'Address label'),
    note: SafeNoteSchema,
  })
  .refine((data) => data.firstName || data.lastName || data.organization, {
    message: 'At least one of firstName, lastName, or organization is required',
  });

export const UpdateContactSchema = z.object({
  id: SafeIdSchema,
  firstName: createOptionalSafeTextSchema(
    VALIDATION.MAX_TITLE_LENGTH,
    'First name',
  ),
  lastName: createOptionalSafeTextSchema(
    VALIDATION.MAX_TITLE_LENGTH,
    'Last name',
  ),
  organization: createOptionalSafeTextSchema(
    VALIDATION.MAX_TITLE_LENGTH,
    'Organization',
  ),
  jobTitle: createOptionalSafeTextSchema(
    VALIDATION.MAX_TITLE_LENGTH,
    'Job title',
  ),
  note: SafeNoteSchema,
});

export const DeleteContactSchema = z.object({
  id: SafeIdSchema,
});

/**
 * Validation error wrapper for consistent error handling across the application
 * @extends Error
 * @class
 * @description Provides structured error information with field-level details for validation failures
 * @param {string} message - Human-readable error message
 * @param {Record<string, string[]>} [details] - Optional field-specific error details
 * @example
 * throw new ValidationError('Invalid input', {
 *   title: ['Title is required', 'Title too long'],
 *   dueDate: ['Invalid date format']
 * });
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Generic validation function with security error handling and detailed logging
 * @template T - Expected type after validation
 * @param {z.ZodSchema<T>} schema - Zod schema to validate against
 * @param {unknown} input - Input data to validate
 * @returns {T} Validated and parsed data
 * @throws {ValidationError} Detailed validation error with field-specific messages
 * @description
 * - Provides detailed field-level error messages
 * - Aggregates multiple validation errors into single error
 * - Includes path information for nested field validation
 * - Throws ValidationError for consistent error handling
 * @example
 * try {
 *   const data = validateInput(CreateReminderSchema, input);
 *   // data is now typed as CreateReminderData
 * } catch (error) {
 *   if (error instanceof ValidationError) {
 *     console.log(error.details); // Field-specific error messages
 *   }
 * }
 */
export const validateInput = <T>(schema: z.ZodSchema<T>, input: unknown): T => {
  try {
    return schema.parse(input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join('; ');

      const errorDetails = error.errors.reduce<Record<string, string[]>>(
        (acc, err) => {
          const path = err.path.join('.');
          acc[path] = acc[path] ?? [];
          acc[path].push(err.message);
          return acc;
        },
        {},
      );

      throw new ValidationError(
        `Input validation failed: ${errorMessages}`,
        errorDetails,
      );
    }

    throw new ValidationError('Input validation failed: Unknown error');
  }
};
