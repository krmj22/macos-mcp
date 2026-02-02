# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
pnpm install

# Build TypeScript and Swift binary (required before running)
pnpm build

# Run all tests
pnpm test

# Run a single test file
pnpm test -- src/path/to/file.test.ts

# Lint and format with Biome
pnpm lint
```

## Architecture

This is an MCP (Model Context Protocol) server providing native macOS integration with Apple Reminders and Calendar via EventKit.

### Layer Structure

```
src/
├── index.ts              # Entry point: loads config, starts server
├── server/
│   ├── server.ts         # MCP server setup with stdio transport
│   ├── handlers.ts       # Request handler registration (tools, prompts)
│   ├── prompts.ts        # Prompt template definitions and builders
│   └── promptAbstractions.ts
├── tools/
│   ├── definitions.ts    # MCP tool schemas (uses dependentSchemas for conditional validation)
│   ├── index.ts          # Tool routing: normalizes names, dispatches to handlers
│   └── handlers/         # Domain-specific CRUD handlers
│       ├── reminderHandlers.ts
│       ├── listHandlers.ts
│       └── calendarHandlers.ts
├── utils/
│   ├── cliExecutor.ts    # Executes Swift binary, parses JSON responses
│   ├── permissionPrompt.ts  # AppleScript-based permission prompting
│   ├── reminderRepository.ts  # Repository pattern for reminders
│   ├── calendarRepository.ts  # Repository pattern for calendar events
│   ├── binaryValidator.ts     # Secure binary path validation
│   └── errorHandling.ts       # Centralized async error wrapper
├── validation/
│   └── schemas.ts        # Zod schemas for input validation
└── types/
    └── index.ts          # TypeScript interfaces and type constants
```

### Data Flow

1. MCP client sends tool call via stdio
2. `handlers.ts` routes to `handleToolCall()` in `tools/index.ts`
3. Tool router normalizes name (supports both `reminders_tasks` and `reminders.tasks`)
4. Action router dispatches to specific handler (e.g., `handleCreateReminder`)
5. Handler validates input via Zod schema, calls repository
6. Repository calls `executeCli()` which:
   - Proactively triggers AppleScript permission prompt on first access
   - Runs Swift binary for EventKit operations
   - Retries with AppleScript fallback on permission errors
7. Swift binary performs EventKit operations, returns JSON
8. Response flows back through layers as `CallToolResult`

### Permission Handling

The server implements a two-layer permission prompt strategy:

1. **Proactive AppleScript Prompt**: On the first access to reminders or calendars, `executeCli()` proactively triggers an AppleScript command to ensure the permission dialog appears, even in non-interactive contexts where the Swift binary's native EventKit permission request may be suppressed.

2. **Swift Binary Permission Check**: The Swift binary checks authorization status and requests permissions through EventKit's native API.

3. **Retry with AppleScript Fallback**: If a permission error occurs after the Swift binary runs, the system retries once with the AppleScript fallback.

This approach ensures permission dialogs appear reliably for MCP clients running in non-interactive contexts (e.g., Claude Code, terminal-based tools).

### Swift Bridge

The `bin/EventKitCLI` binary handles all native macOS EventKit operations. TypeScript communicates via JSON:

```typescript
// CLI returns: { "status": "success", "result": {...} } or { "status": "error", "message": "..." }
const result = await executeCli<Reminder[]>(['--action', 'read', '--showCompleted', 'true']);
```

## Key Patterns

### Zod Schema Validation

All handler inputs are validated through Zod schemas in `validation/schemas.ts`. The tool definitions use `dependentSchemas` for conditional validation based on action type.

### Repository Pattern

Data access is abstracted through repositories (`reminderRepository.ts`, `calendarRepository.ts`) that handle CLI execution and response mapping.

### Error Handling

Use `handleAsyncOperation()` wrapper from `errorHandling.ts` for consistent error formatting:

```typescript
return handleAsyncOperation(async () => {
  // operation logic
}, 'operation description');
```

### Tool Naming

Tools support both underscore and dot notation:
- `reminders_tasks` / `reminders.tasks`
- `reminders_lists` / `reminders.lists`
- `calendar_events` / `calendar.events`
- `calendar_calendars` / `calendar.calendars`

## Testing

- Tests use Jest with ts-jest ESM preset
- Mock the CLI executor in `src/utils/__mocks__/cliExecutor.ts`
- Coverage threshold: 96% statements, 90% branches
- Swift binary tests in `src/swift/Info.plist.test.ts` validate permission keys

## Critical Constraints

- **macOS only**: Requires EventKit framework
- **Permission handling**: Swift layer manages `EKEventStore.authorizationStatus()`
- **Binary security**: Path validation in `binaryValidator.ts` restricts allowed binary locations
- **Date formats**: Prefer `YYYY-MM-DD HH:mm:ss` for local time, ISO 8601 with timezone for UTC
