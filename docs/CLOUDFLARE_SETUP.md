# Cloudflare Tunnel and Access Setup Guide

This guide walks you through setting up secure remote access to your macos-mcp server using Cloudflare Tunnel and Cloudflare Access.

## Overview

The setup involves:
1. **Cloudflare Tunnel** - Creates a secure outbound connection from your Mac to Cloudflare's edge network
2. **Cloudflare Access** - Adds authentication (email OTP) so only authorized users can connect
3. **macos-mcp** - Validates Cloudflare Access JWTs for defense-in-depth security

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Claude iOS    │──────│  Cloudflare     │──────│   Your Mac      │
│   or Desktop    │ HTTPS│  Edge + Access  │tunnel│   macos-mcp     │
└─────────────────┘      └─────────────────┘      └─────────────────┘
```

## Prerequisites

- **Cloudflare account** (free tier works)
- **Custom domain** in Cloudflare (or use `.cfargotunnel.com` subdomain)
- **Mac Mini/Studio** (always-on recommended for remote access)
- **macos-mcp built and working locally** (`pnpm build && pnpm test`)

## Step 1: Install cloudflared

```bash
brew install cloudflared
```

Verify installation:

```bash
cloudflared --version
```

## Step 2: Authenticate with Cloudflare

```bash
cloudflared tunnel login
```

This opens your browser to log in to Cloudflare. After authentication, a certificate is saved to `~/.cloudflared/cert.pem`.

## Step 3: Create a Tunnel

```bash
cloudflared tunnel create macos-mcp
```

Output example:
```
Tunnel credentials written to $HOME/.cloudflared/abc123-def456-ghi789.json
Created tunnel macos-mcp with id abc123-def456-ghi789
```

**Important:** Note the tunnel UUID (e.g., `abc123-def456-ghi789`). You'll need it for configuration.

## Step 4: Configure the Tunnel

Create the tunnel configuration file:

```bash
mkdir -p ~/.cloudflared
```

Create `~/.cloudflared/config.yml`:

```yaml
# Tunnel UUID from Step 3
tunnel: YOUR_TUNNEL_UUID

# Path to credentials file (auto-generated in Step 3)
credentials-file: $HOME/.cloudflared/YOUR_TUNNEL_UUID.json

ingress:
  # Route your subdomain to the local MCP server
  - hostname: mcp.yourdomain.com
    service: http://localhost:3847
    originRequest:
      # Keep connections alive for SSE
      noTLSVerify: false
      connectTimeout: 30s

  # Catch-all for unmatched requests
  - service: http_status:404
```

Replace:
- `YOUR_TUNNEL_UUID` - The UUID from Step 3
- `$HOME` - Expands to your home directory automatically
- `mcp.yourdomain.com` - Your desired subdomain

## Step 5: Create DNS Record

Route your subdomain through the tunnel:

```bash
cloudflared tunnel route dns macos-mcp mcp.yourdomain.com
```

This creates a CNAME record pointing to your tunnel.

## Step 6: Test the Tunnel (Optional)

Before configuring Access, verify the tunnel works:

```bash
# In one terminal, start macos-mcp in HTTP mode
MCP_TRANSPORT=http MCP_HTTP_ENABLED=true node dist/index.js

# In another terminal, start the tunnel
cloudflared tunnel run macos-mcp
```

Visit `https://mcp.yourdomain.com/health` in your browser. You should see a JSON health response.

**Warning:** Without Cloudflare Access, your server is publicly accessible. Proceed to Step 7 immediately.

## Step 7: Configure Cloudflare Access

Cloudflare Access adds authentication before requests reach your tunnel.

### 7.1: Open Zero Trust Dashboard

1. Go to [Cloudflare Zero Trust](https://one.dash.cloudflare.com/)
2. Navigate to **Access** > **Applications**

### 7.2: Add Self-Hosted Application

1. Click **Add an application**
2. Select **Self-hosted**

### 7.3: Configure Application

**Application Configuration:**
- **Application name:** macos-mcp
- **Session Duration:** 24 hours (or your preference)
- **Application domain:** `mcp.yourdomain.com`
- **Path:** Leave empty (protects entire domain)

### 7.4: Add Access Policy

Create a policy to control who can access your server:

**Policy name:** Allow Personal Email

**Configure rules:**
- **Action:** Allow
- **Include:**
  - **Selector:** Emails
  - **Value:** your.email@example.com

Or to allow an entire domain:
- **Selector:** Emails ending in
- **Value:** @yourdomain.com

### 7.5: Get Application Credentials

After creating the application:

1. Go to the application settings
2. Note the **Application Audience (AUD)** tag
3. Your **Team Domain** is shown at the top of Zero Trust dashboard (e.g., `yourteam.cloudflareaccess.com`)

## Step 8: Configure macos-mcp Server

Create `macos-mcp.config.json` in your project root:

```json
{
  "transport": "http",
  "http": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 3847,
    "cloudflareAccess": {
      "teamDomain": "yourteam.cloudflareaccess.com",
      "policyAUD": "YOUR_APPLICATION_AUD_TAG",
      "allowedEmails": ["your.email@example.com"]
    }
  }
}
```

Or use environment variables:

```bash
export MCP_TRANSPORT=http
export MCP_HTTP_ENABLED=true
export MCP_HTTP_PORT=3847
export CF_ACCESS_TEAM_DOMAIN=yourteam.cloudflareaccess.com
export CF_ACCESS_POLICY_AUD=YOUR_APPLICATION_AUD_TAG
export CF_ACCESS_ALLOWED_EMAILS=your.email@example.com
```

**Configuration Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `transport` | `stdio`, `http`, or `both` | `stdio` |
| `http.enabled` | Enable HTTP transport | `false` |
| `http.host` | Bind address | `127.0.0.1` |
| `http.port` | HTTP port | `3847` |
| `cloudflareAccess.teamDomain` | Your Zero Trust team domain | Required |
| `cloudflareAccess.policyAUD` | Application audience tag | Required |
| `cloudflareAccess.allowedEmails` | Extra email allowlist | Optional |

## Step 9: Create LaunchAgent for Auto-Start

For the server to start automatically on boot, create a LaunchAgent.

### 9.1: Create macos-mcp LaunchAgent

Create `~/Library/LaunchAgents/com.macos-mcp.server.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.macos-mcp.server</string>

    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/path/to/macos-mcp/dist/index.js</string>
    </array>

    <key>EnvironmentVariables</key>
    <dict>
        <key>MCP_TRANSPORT</key>
        <string>http</string>
        <key>MCP_HTTP_ENABLED</key>
        <string>true</string>
        <key>CF_ACCESS_TEAM_DOMAIN</key>
        <string>yourteam.cloudflareaccess.com</string>
        <key>CF_ACCESS_POLICY_AUD</key>
        <string>YOUR_APPLICATION_AUD_TAG</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>/tmp/macos-mcp.log</string>

    <key>StandardErrorPath</key>
    <string>/tmp/macos-mcp.error.log</string>

    <key>WorkingDirectory</key>
    <string>/path/to/macos-mcp</string>
</dict>
</plist>
```

Replace:
- `/usr/local/bin/node` - Path to node (run `which node` to find it)
- `/path/to/macos-mcp` - Your project directory

### 9.2: Create cloudflared LaunchAgent

Create `~/Library/LaunchAgents/com.cloudflare.cloudflared.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.cloudflare.cloudflared</string>

    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/cloudflared</string>
        <string>tunnel</string>
        <string>run</string>
        <string>macos-mcp</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>/tmp/cloudflared.log</string>

    <key>StandardErrorPath</key>
    <string>/tmp/cloudflared.error.log</string>
</dict>
</plist>
```

Replace `/opt/homebrew/bin/cloudflared` with your cloudflared path (run `which cloudflared`).

### 9.3: Load the LaunchAgents

```bash
# Load macos-mcp server
launchctl load ~/Library/LaunchAgents/com.macos-mcp.server.plist

# Load cloudflared tunnel
launchctl load ~/Library/LaunchAgents/com.cloudflare.cloudflared.plist
```

### 9.4: Verify Services are Running

```bash
# Check macos-mcp
launchctl list | grep macos-mcp

# Check cloudflared
launchctl list | grep cloudflared

# View logs
tail -f /tmp/macos-mcp.log
tail -f /tmp/cloudflared.log
```

## Step 10: Grant Automation Permissions (Contacts, Calendar, Reminders, Mail, Notes)

macOS Automation permissions require an **interactive GUI prompt** — the user must click "Allow" in a system dialog. These prompts **cannot appear** through a LaunchAgent, SSH session, or any non-GUI context. You must grant them once via a local graphical session before the LaunchAgent can use JXA-based tools.

**This is a one-time setup.** Once granted, Automation permissions persist across reboots and LaunchAgent restarts until manually revoked in System Settings.

### 10.1: Stop the LaunchAgent

Prevent the LaunchAgent from competing for permission prompts:

```bash
launchctl unload ~/Library/LaunchAgents/com.macos-mcp.server.plist
```

### 10.2: Grant Permissions via Local GUI Terminal

You **must** run these commands from a Terminal window on the Mac's graphical desktop — either physically at the machine or via Screen Sharing / VNC. SSH sessions cannot display GUI permission dialogs.

**Connect via Screen Sharing from another Mac:**
```bash
# Enable Screen Sharing on the server Mac (if not already enabled)
sudo launchctl load -w /System/Library/LaunchDaemons/com.apple.screensharing.plist

# From your client Mac, connect:
open vnc://your-mac-hostname.local
```

**Run each command in Terminal on the remote desktop.** Click "Allow" on every macOS permission dialog that appears:

```bash
# Contacts (JXA Automation)
/usr/bin/osascript -l JavaScript -e 'Application("Contacts").people().length'

# Calendar (JXA Automation)
/usr/bin/osascript -l JavaScript -e 'Application("Calendar").calendars().length'

# Reminders (JXA Automation)
/usr/bin/osascript -l JavaScript -e 'Application("Reminders").defaultList().name()'

# Mail (JXA Automation)
/usr/bin/osascript -l JavaScript -e 'Application("Mail").inbox().messages().length'

# Notes (JXA Automation)
/usr/bin/osascript -l JavaScript -e 'Application("Notes").notes().length'
```

Each command should return a number or string (not an error). If a command hangs without showing a dialog, the terminal process may not be able to trigger prompts — check System Settings > Privacy & Security > Automation manually.

### 10.3: Verify with Preflight Check

```bash
cd /path/to/macos-mcp
node dist/index.js --check
```

All checks should show `[PASS]`.

### 10.4: Reload the LaunchAgent

```bash
launchctl load ~/Library/LaunchAgents/com.macos-mcp.server.plist
```

### 10.5: When Permissions Need Re-granting

Automation permissions are tied to the **calling binary**. You may need to repeat this step if:
- You upgrade or reinstall your terminal app
- You reset privacy permissions via `tccutil reset AppleEvents`
- macOS prompts again after a major OS update

You do **not** need to repeat this for Node.js upgrades, LaunchAgent restarts, or reboots.

## Step 11: Grant Full Disk Access for Messages

The Messages tool relies on direct SQLite access to `~/Library/Messages/chat.db` because JXA message reading is broken on macOS Sonoma and later (throws "Can't convert types"). macOS restricts access to this database behind **Full Disk Access**.

- **stdio transport**: Grant Full Disk Access to your **terminal app** (Terminal, iTerm2, etc.)
- **HTTP transport (LaunchAgent)**: Grant Full Disk Access to the **node binary itself** since there is no terminal app in the process chain

### 11.1: Find Your Actual Node Binary Path

Version managers (Volta, nvm, fnm) use shims or symlinks that point to a launcher, not the real node binary. You must add the **actual binary**, not the shim.

```bash
# Recommended: this resolves through all symlinks to the real binary
node -e "console.log(process.execPath)"
```

Expected output by version manager:

| Manager | `which node` (shim -- do NOT use) | Actual binary (use this) |
|---------|----------------------------------|--------------------------|
| **Volta** | `~/.volta/bin/node` | `~/.volta/tools/image/node/<VERSION>/bin/node` |
| **nvm** | `~/.nvm/versions/node/<VERSION>/bin/node` | Same (nvm uses real paths) |
| **fnm** | `~/.local/share/fnm/aliases/default/bin/node` | `~/.local/share/fnm/node-versions/<VERSION>/installation/bin/node` |
| **Homebrew** | `/opt/homebrew/bin/node` | `/opt/homebrew/Cellar/node/<VERSION>/bin/node` |
| **System** | `/usr/local/bin/node` | `/usr/local/bin/node` |

**Volta users:** `~/.volta/bin/node` is a symlink to `volta-shim`, a launcher that delegates to the real binary. macOS grants FDA to the actual executable, so you must add the resolved path (e.g., `~/.volta/tools/image/node/22.12.0/bin/node`). You can also use `volta which node` to get this path.

The path must match the `ProgramArguments` in your LaunchAgent plist from Step 9.

### 11.2: Grant Full Disk Access

There are two methods. **Method A (drag-and-drop)** is more reliable because the Finder file picker in System Settings sometimes fails to show binaries in hidden directories (paths starting with `.`).

#### Method A: Reveal in Finder and Drag-and-Drop (Recommended)

This method bypasses the file picker entirely:

```bash
# 1. Open the Full Disk Access settings pane
open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"

# 2. Reveal the actual node binary in Finder
open -R "$(node -e "console.log(process.execPath)")"
```

Then:
1. In System Settings, click the **+** button (unlock with your password if needed)
2. **Instead of using the file picker**, drag the `node` binary directly from the Finder window into the Full Disk Access list
3. Ensure the toggle next to the node entry is **enabled**

#### Method B: Use the File Picker with Go to Folder

1. Open **System Settings** > **Privacy & Security** > **Full Disk Access**
2. Click the **+** button (you may need to unlock with your password)
3. Press **Cmd+Shift+G** to open the "Go to Folder" dialog
4. Paste the full path to your node binary (from Step 11.1)
5. Click **Open** to add it
6. Ensure the toggle next to the node entry is **enabled**

> **Tip:** If the Go to Folder dialog doesn't show the binary or the list appears empty after adding, use Method A instead.

### 11.3: Restart the LaunchAgent

Full Disk Access changes require a process restart to take effect:

```bash
launchctl unload ~/Library/LaunchAgents/com.macos-mcp.server.plist
launchctl load ~/Library/LaunchAgents/com.macos-mcp.server.plist
```

### 11.4: Verify Messages Access

```bash
# Quick test: can the current node binary read the Messages database?
node -e "
const fs = require('fs');
const path = require('os').homedir() + '/Library/Messages/chat.db';
try {
  fs.accessSync(path, fs.constants.R_OK);
  console.log('Full Disk Access is working — Messages DB is readable');
} catch {
  console.error('Access denied — Full Disk Access not granted for this node binary');
  process.exit(1);
}
"
```

If you see "Access denied", see the troubleshooting section below.

### 11.5: Troubleshooting Full Disk Access

**Binary doesn't appear in the list after adding:**
- The Finder file picker in System Settings can fail to display binaries in hidden directories. Use the drag-and-drop method (Method A in Step 11.2) instead.
- Verify the file exists: `ls -la "$(node -e "console.log(process.execPath)")"` -- it should show a real file, not a broken symlink.

**Added the binary but Messages still don't work:**
- You may have added the shim instead of the actual binary. Run `node -e "console.log(process.execPath)"` and compare with what's in the FDA list. Volta's `~/.volta/bin/node` is a shim -- you need the resolved path under `~/.volta/tools/image/node/`.
- Restart the LaunchAgent after granting access (Step 11.3). FDA changes only apply to newly started processes.

**Node version changed after upgrading:**
- Version managers install new binaries when you upgrade Node.js. The old binary path in the FDA list becomes stale.
- After upgrading, re-run Step 11.1 to get the new path, then repeat Steps 11.2-11.4.
- Also update the `ProgramArguments` in your LaunchAgent plist if it uses the full versioned path.

**Helper commands for diagnosing FDA issues:**

```bash
# Show the actual binary that needs FDA
node -e "console.log(process.execPath)"

# Reveal it in Finder for drag-and-drop
open -R "$(node -e "console.log(process.execPath)")"

# Open the FDA settings pane directly
open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"

# Test read access to Messages database
node -e "require('fs').accessSync(require('os').homedir()+'/Library/Messages/chat.db'); console.log('OK')"
```

## Step 12: Register in Claude iOS/Desktop

### Claude iOS

1. Open Claude iOS app
2. Go to **Settings** > **MCP Servers**
3. Add new server:
   - **URL:** `https://mcp.yourdomain.com/mcp`
   - **Name:** macos-mcp (optional)
4. You'll be prompted to authenticate via Cloudflare Access

### Claude Desktop (Remote)

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "macos-mcp-remote": {
      "url": "https://mcp.yourdomain.com/mcp"
    }
  }
}
```

## Troubleshooting

### Tunnel Not Connecting

```bash
# Check tunnel status
cloudflared tunnel info macos-mcp

# Test tunnel locally
cloudflared tunnel run macos-mcp --loglevel debug
```

**Common issues:**
- Credentials file missing - Re-run `cloudflared tunnel create macos-mcp`
- Config file path wrong - Verify `~/.cloudflared/config.yml` exists
- DNS not propagated - Wait a few minutes, check with `dig mcp.yourdomain.com`

### 401 Unauthorized Errors

If you get authentication errors:

1. **Clear browser cookies** for your domain
2. **Verify Access policy** allows your email
3. **Check AUD tag** matches exactly in config
4. **Check team domain** is correct (include `.cloudflareaccess.com`)

```bash
# Debug JWT verification
curl -v https://mcp.yourdomain.com/health
```

### Server Not Responding

```bash
# Check server is running
curl http://localhost:3847/health

# Check logs
tail -100 /tmp/macos-mcp.error.log

# Restart services
launchctl unload ~/Library/LaunchAgents/com.macos-mcp.server.plist
launchctl load ~/Library/LaunchAgents/com.macos-mcp.server.plist
```

### LaunchAgent Not Starting

```bash
# Check for syntax errors
plutil -lint ~/Library/LaunchAgents/com.macos-mcp.server.plist

# View launchd errors
log show --predicate 'subsystem == "com.apple.launchd"' --last 5m

# Manual start for debugging
launchctl start com.macos-mcp.server
```

### Messages Tool Not Working

The Messages tool is the most common source of issues when running via HTTP transport. JXA message reading is broken on macOS Sonoma+, so the server falls back to reading `~/Library/Messages/chat.db` directly via SQLite. This database is protected by Full Disk Access.

**Symptoms:**
- Messages tool returns empty results or errors via Claude iOS/web
- Other tools (Reminders, Calendar, Notes) work fine
- Error logs show `SQLITE_CANTOPEN` or permission denied for `chat.db`

**Fix:**
1. Ensure you added the **actual node binary**, not a shim (see Step 11.1)
2. Use the drag-and-drop method if the file picker didn't work (see Step 11.2, Method A)
3. Restart the LaunchAgent after granting access (Step 11.3)
4. Verify with the test command in Step 11.4

**Checking logs for Messages errors:**
```bash
grep -i "messages\|chat.db\|sqlite" /tmp/macos-mcp.error.log
```

See Step 11.5 for additional troubleshooting.

### Permission Issues

Several tools require specific macOS permissions. When running as a LaunchAgent (HTTP transport), permissions must be granted to the **node binary** rather than a terminal app since there is no terminal in the process chain.

**For Messages (Full Disk Access):**
See Step 11 for detailed instructions including troubleshooting.

**For other tools (Automation permissions):**
1. Go to **System Settings** > **Privacy & Security** > **Automation**
2. Ensure the node binary has permission for Notes, Mail, and Contacts
3. Note: Automation permission dialogs may not appear in non-interactive contexts (LaunchAgent). You may need to run the server interactively once to trigger the permission prompts.

## Security Considerations

### Defense in Depth

This setup provides multiple security layers:

1. **Cloudflare Access** - Authentication at the edge (email OTP)
2. **JWT Verification** - macos-mcp validates Cloudflare JWTs
3. **Email Allowlist** - Optional additional email filtering
4. **Localhost Binding** - Server only accepts local connections

### Recommendations

- **Use strong email authentication** - Consider using a email provider with MFA
- **Limit allowed emails** - Use specific email addresses, not domain-wide rules
- **Monitor Access logs** - Review Cloudflare Access logs for suspicious activity
- **Keep software updated** - Regularly update cloudflared and macos-mcp
- **Use separate domain** - Don't expose other services on the same domain

### What NOT to Do

- **Never** expose the HTTP server directly to the internet without Cloudflare Access
- **Never** disable JWT verification in production
- **Never** use `http.host: "0.0.0.0"` without authentication configured

## Quick Reference

### Useful Commands

```bash
# Tunnel management
cloudflared tunnel list
cloudflared tunnel info macos-mcp
cloudflared tunnel delete macos-mcp

# DNS management
cloudflared tunnel route dns macos-mcp mcp.yourdomain.com

# Service control
launchctl load ~/Library/LaunchAgents/com.macos-mcp.server.plist
launchctl unload ~/Library/LaunchAgents/com.macos-mcp.server.plist
launchctl list | grep -E "(macos-mcp|cloudflared)"

# Logs
tail -f /tmp/macos-mcp.log
tail -f /tmp/cloudflared.log
```

### Configuration Files

| File | Purpose |
|------|---------|
| `~/.cloudflared/cert.pem` | Cloudflare authentication certificate |
| `~/.cloudflared/config.yml` | Tunnel configuration |
| `~/.cloudflared/<uuid>.json` | Tunnel credentials |
| `macos-mcp.config.json` | Server configuration |
| `~/Library/LaunchAgents/com.macos-mcp.server.plist` | Server auto-start |
| `~/Library/LaunchAgents/com.cloudflare.cloudflared.plist` | Tunnel auto-start |

## Next Steps

After completing this setup:

1. **Test from Claude iOS** - Verify you can access macOS tools remotely
2. **Set up monitoring** - Consider log aggregation for troubleshooting
3. **Configure backups** - Back up your `~/.cloudflared` directory
4. **Document your setup** - Keep note of your tunnel UUID and configuration
