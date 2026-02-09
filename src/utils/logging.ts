/**
 * logging.ts
 * Structured logging utilities for server-side diagnostics.
 * All output goes to stderr so it appears in `tail -f /tmp/macos-mcp.err`.
 */

/**
 * Sanitizes tool arguments for logging by redacting potentially sensitive values.
 * Keeps the structure visible for debugging while avoiding leaking message content.
 */
function sanitizeArgs(args: unknown): unknown {
  if (args === undefined || args === null) return args;
  if (typeof args !== 'object') return args;

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    // Redact message body content but keep structural fields
    if (key === 'text' && typeof value === 'string') {
      sanitized[key] = `[${value.length} chars]`;
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Logs a tool dispatch event to stderr in structured JSON format.
 * Emits on every tool call -- enables diagnosing "tool not found" reports
 * by confirming whether requests actually reached the server.
 *
 * @param toolName - The raw tool name from the request
 * @param normalizedName - The name after alias resolution
 * @param found - Whether the tool resolved to a known handler
 * @param action - The action being performed (e.g. "read", "create")
 * @param durationMs - Execution time in milliseconds (omitted if not yet complete)
 * @param isError - Whether the result was an error
 */
export function logToolCall(
  toolName: string,
  normalizedName: string,
  found: boolean,
  action?: string,
  durationMs?: number,
  isError?: boolean,
): void {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level: found ? 'info' : 'warn',
    event: 'tool_dispatch',
    tool: toolName,
  };

  // Only include normalized name if it differs from the raw name
  if (normalizedName !== toolName) {
    entry.normalizedTool = normalizedName;
  }

  entry.found = found;

  if (action !== undefined) {
    entry.action = action;
  }

  if (durationMs !== undefined) {
    entry.durationMs = durationMs;
  }

  if (isError !== undefined) {
    entry.isError = isError;
  }

  process.stderr.write(`${JSON.stringify(entry)}\n`);
}

/**
 * Logs a tool execution error to stderr in structured JSON format.
 *
 * Includes:
 * - Tool name and sanitized arguments for reproduction
 * - Error message and type
 * - Stack trace when NODE_ENV=development or DEBUG is set
 *
 * @param toolName - The normalized tool name that failed
 * @param args - The arguments passed to the tool (sanitized before logging)
 * @param error - The error that occurred (Error instance, string, or unknown)
 */
export function logToolError(
  toolName: string,
  args: unknown,
  error: unknown,
): void {
  const isDev = process.env.NODE_ENV === 'development' || !!process.env.DEBUG;

  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level: 'error',
    event: 'tool_execution_error',
    tool: toolName,
    args: sanitizeArgs(args),
  };

  if (error instanceof Error) {
    entry.error = error.message;
    entry.errorType = error.constructor.name;
    if (isDev && error.stack) {
      entry.stack = error.stack;
    }
  } else if (typeof error === 'string') {
    entry.error = error;
  } else {
    entry.error = 'Unknown error';
  }

  process.stderr.write(`${JSON.stringify(entry)}\n`);
}
