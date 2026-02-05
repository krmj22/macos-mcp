# Contributing to macos-mcp

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

### Prerequisites

- **macOS** (required - this project uses native macOS APIs)
- **Node.js** 18+ (we test on 18, 20, and 22)
- **pnpm** (install via `corepack enable`)
- **Xcode Command Line Tools** (for Swift compilation)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/krmj22/macos-mcp.git
cd macos-mcp

# Install dependencies
pnpm install

# Build (TypeScript + Swift binary)
pnpm build

# Run tests
pnpm test

# Lint and format
pnpm lint
```

### Project Structure

```
src/
├── tools/
│   ├── definitions.ts    # MCP tool schemas
│   ├── index.ts          # Tool routing
│   └── handlers/         # Domain handlers
├── utils/
│   ├── cliExecutor.ts    # Swift binary execution
│   ├── jxaExecutor.ts    # JXA/AppleScript execution
│   └── sqliteMessageReader.ts
└── validation/
    └── schemas.ts        # Zod validation schemas
```

## Making Changes

### Before You Start

1. Check existing [issues](https://github.com/krmj22/macos-mcp/issues) to avoid duplicate work
2. For significant changes, open an issue first to discuss the approach

### Code Style

We use [Biome](https://biomejs.dev/) for linting and formatting. Run before committing:

```bash
pnpm lint
```

This will auto-fix formatting issues and report any linting errors.

### Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/). This enables automatic versioning and changelog generation.

**Format:**
```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature (triggers minor version bump)
- `fix`: Bug fix (triggers patch version bump)
- `docs`: Documentation only
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples:**
```
feat(calendar): add support for recurring events
fix(messages): handle empty chat list gracefully
docs: update installation instructions
```

**Breaking changes:** Add `BREAKING CHANGE:` in the footer or `!` after the type:
```
feat(api)!: rename tool from reminders to reminders_tasks
```

### Testing

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test -- --watch

# Run specific test file
pnpm test -- src/tools/handlers/reminderHandlers.test.ts
```

We maintain high test coverage (96%+ statements, 90%+ branches). Please include tests for new functionality.

### Building

```bash
# Full build (cleans, compiles TypeScript, builds Swift binary)
pnpm build

# Individual steps
pnpm run build:ts      # TypeScript only
pnpm run build:swift   # Swift binary only
```

## Pull Request Process

1. **Fork** the repository and create your branch from `main`
2. **Make your changes** with appropriate tests
3. **Run the full check**: `pnpm lint && pnpm build && pnpm test`
4. **Push** your branch and open a pull request
5. **Fill out** the PR template with:
   - Summary of changes
   - How you tested it
   - Any breaking changes

### PR Checklist

- [ ] Tests pass locally
- [ ] Linting passes (`pnpm lint`)
- [ ] Build succeeds (`pnpm build`)
- [ ] Commit messages follow conventional commits
- [ ] Documentation updated if needed

## macOS Permissions

When testing locally, you may need to grant permissions:

| App | Permission | Location |
|-----|------------|----------|
| Reminders | Full Access | Privacy & Security → Reminders |
| Calendar | Full Access | Privacy & Security → Calendars |
| Notes | Automation | Privacy & Security → Automation → Notes |
| Mail | Automation | Privacy & Security → Automation → Mail |
| Messages | Automation + Full Disk Access | Both locations |
| Contacts | Automation | Privacy & Security → Automation → Contacts |

## Questions?

- Open an [issue](https://github.com/krmj22/macos-mcp/issues) for bugs or feature requests
- Start a [discussion](https://github.com/krmj22/macos-mcp/discussions) for questions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
