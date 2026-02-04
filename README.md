# macos-mcp ![License: MIT](https://img.shields.io/badge/license-MIT-green)

> Based on [FradSer/mcp-server-apple-events](https://github.com/FradSer/mcp-server-apple-events)

A Model Context Protocol (MCP) server for native macOS app integration: **Reminders**, **Calendar**, **Notes**, **Mail**, **Messages**, and **Contacts**.

## Architecture

The server uses two bridging strategies to communicate with Apple apps:

- **EventKit (Swift binary)** — Reminders and Calendar. A compiled Swift CLI binary performs EventKit operations and returns JSON.
- **JXA (JavaScript for Automation)** — Notes, Mail, Messages. Scripts run via `osascript -l JavaScript` with template-based parameter interpolation.

## Features

### Reminders (EventKit)
- Full CRUD for reminder tasks and lists
- Smart filtering by completion status, due date ranges, full-text search
- Organization strategies (priority, category, due date, completion)

### Calendar (EventKit)
- Full CRUD for calendar events with recurrence support
- List available calendars
- Date range and keyword filtering

### Notes (JXA)
- Full CRUD for notes
- Folder management (list, create)
- Search by title/content with pagination

### Mail (JXA)
- Read inbox, specific mailboxes, or individual messages
- Create drafts with CC/BCC support
- Reply to existing messages (auto-quotes original)
- Mark messages read/unread, delete messages
- List all mailboxes across accounts
- Search by subject, sender, or body content

### Contacts (JXA)
- List contacts with pagination
- Create new contacts with email, phone, address
- Delete contacts
- *Note: Update and search have known issues*

### Messages (JXA)
- List iMessage chats with pagination
- Read messages from specific chats
- Send messages to existing chats or new recipients
- Search chats by name/participant or search message content

## Available MCP Tools

| Tool | App | Bridge | Actions |
|------|-----|--------|---------|
| `reminders_tasks` | Reminders | EventKit | read, create, update, delete |
| `reminders_lists` | Reminders | EventKit | read, create, update, delete |
| `calendar_events` | Calendar | EventKit | read, create, update, delete |
| `calendar_calendars` | Calendar | EventKit | read |
| `notes_items` | Notes | JXA | read, create, update, delete |
| `notes_folders` | Notes | JXA | read, create |
| `mail_messages` | Mail | JXA | read, create, update, delete |
| `messages_chat` | Messages | JXA | read, create |
| `contacts_people` | Contacts | JXA | read, create, delete |

All tools support both underscore (`reminders_tasks`) and dot (`reminders.tasks`) notation.

## Prerequisites

- **Node.js 18 or later**
- **macOS** (required for EventKit and JXA)
- **Xcode Command Line Tools** (required for compiling Swift code)
- **pnpm** (recommended for package management)

## macOS Permission Requirements (Sonoma 14+ / Sequoia 15)

### EventKit (Reminders & Calendar)

Apple separates Reminders and Calendar permissions into *write-only* and *full-access* scopes. The Swift bridge declares the following privacy keys:

- `NSRemindersUsageDescription` / `NSRemindersFullAccessUsageDescription` / `NSRemindersWriteOnlyAccessUsageDescription`
- `NSCalendarsUsageDescription` / `NSCalendarsFullAccessUsageDescription` / `NSCalendarsWriteOnlyAccessUsageDescription`

If a permission failure occurs, the Node.js layer automatically runs a minimal AppleScript to surface the dialog and retries.

### JXA (Notes, Mail, Messages)

JXA-based tools require macOS Automation permissions. On first use, macOS will prompt you to allow `osascript` to control each app. Grant access via **System Settings > Privacy & Security > Automation**.

**Verification command:**

```bash
pnpm test -- src/swift/Info.plist.test.ts
```

## Quick Start

```bash
# Clone and install
git clone https://github.com/krmj22/macos-mcp.git
cd macos-mcp
pnpm install

# Build TypeScript and Swift binary
pnpm build
```

## Configuration

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "macos-mcp": {
      "command": "node",
      "args": ["/path/to/macos-mcp/dist/index.js"]
    }
  }
}
```

### Cursor

1. Open Cursor Settings > MCP > Add new global MCP server
2. Configure:
    ```json
    {
      "mcpServers": {
        "macos-mcp": {
          "command": "node",
          "args": ["/path/to/macos-mcp/dist/index.js"]
        }
      }
    }
    ```

## Usage Examples

### Reminders
```
Create a reminder to "Buy groceries" for tomorrow at 5 PM.
Show all reminders in my "Work" list.
Organize my reminders by priority.
```

### Calendar
```
Create a meeting "Team Standup" tomorrow from 10 AM to 10:30 AM.
Show my calendar events for this week.
```

### Notes
```
Create a note titled "Meeting Notes" in the Work folder.
Search my notes for "project plan".
List all note folders.
```

### Mail
```
Show my inbox.
Read the email from John about the project.
Send an email to alice@example.com about the meeting.
Reply to the last email from Bob.
```

### Messages
```
Show my recent iMessage chats.
Read messages from the chat with John.
Send "On my way!" to the group chat.
```

## Structured Prompt Library

The server ships with prompt templates exposed via MCP `ListPrompts` and `GetPrompt` endpoints:

- **daily-task-organizer** — optional `today_focus` input produces a same-day execution blueprint
- **smart-reminder-creator** — optional `task_idea` generates an optimally scheduled reminder
- **reminder-review-assistant** — optional `review_focus` to audit and optimize existing reminders
- **weekly-planning-workflow** — optional `user_ideas` guides a Monday-through-Sunday reset

Run `pnpm test -- src/server/prompts.test.ts` to validate prompt metadata and schema compatibility.

## Development

```bash
pnpm install          # Install dependencies
pnpm build            # Build TypeScript + Swift binary
pnpm test             # Run full test suite
pnpm lint             # Lint and format with Biome + TypeScript check
```

### Dependencies

**Runtime:** `@modelcontextprotocol/sdk`, `exit-on-epipe`, `tsx`, `zod`

**Dev:** `typescript`, `jest`, `ts-jest`, `babel-jest`, `@biomejs/biome`

## License

MIT

## Contributing

Contributions welcome! Please read the contributing guidelines first.
