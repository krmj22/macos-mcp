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

## Step 10: Grant Full Disk Access for Messages

The Messages tool relies on direct SQLite access to `~/Library/Messages/chat.db` because JXA message reading is broken on macOS Sonoma and later (throws "Can't convert types"). macOS restricts access to this database behind **Full Disk Access**.

When running via a terminal, your terminal app needs Full Disk Access. When running as a LaunchAgent (HTTP transport), the **node binary itself** needs Full Disk Access since there is no terminal app in the process chain.

### 10.1: Find Your Node Binary Path

```bash
# If using Volta
which node
# Typical output: /Users/<user>/.volta/bin/node

# If using Homebrew
which node
# Typical output: /opt/homebrew/bin/node

# If using system Node
which node
# Typical output: /usr/local/bin/node
```

The path must match the `ProgramArguments` in your LaunchAgent plist from Step 9.

### 10.2: Grant Full Disk Access

1. Open **System Settings** > **Privacy & Security** > **Full Disk Access**
2. Click the **+** button (you may need to unlock with your password)
3. Press **Cmd+Shift+G** to open the "Go to Folder" dialog
4. Paste the full path to your node binary (e.g., `/Users/<user>/.volta/bin/node`)
5. Click **Open** to add it
6. Ensure the toggle next to the node entry is **enabled**

### 10.3: Restart the LaunchAgent

Full Disk Access changes require a process restart to take effect:

```bash
launchctl unload ~/Library/LaunchAgents/com.macos-mcp.server.plist
launchctl load ~/Library/LaunchAgents/com.macos-mcp.server.plist
```

### 10.4: Verify Messages Access

```bash
# Test that the node process can read the Messages database
node -e "const db = require('better-sqlite3')('$HOME/Library/Messages/chat.db'); console.log('Messages DB accessible');" 2>&1 || echo "Access denied - check Full Disk Access"
```

If you see "Access denied", double-check that:
- The correct node binary path is listed in Full Disk Access
- The toggle is enabled
- You restarted the LaunchAgent after granting access

> **Note:** If you use a version manager (Volta, nvm, fnm), the node path may change when you install a new Node.js version. After upgrading Node.js, verify that Full Disk Access still points to the correct binary.

## Step 11: Register in Claude iOS/Desktop

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

The Messages tool is the most common source of issues when running via HTTP transport. This is because JXA message reading is broken on macOS Sonoma+, so the server falls back to reading `~/Library/Messages/chat.db` directly via SQLite. This database is protected by Full Disk Access.

**Symptoms:**
- Messages tool returns empty results or errors via Claude iOS/web
- Other tools (Reminders, Calendar, Notes) work fine
- Error logs show `SQLITE_CANTOPEN` or permission denied for `chat.db`

**Fix:**
1. Grant Full Disk Access to your node binary (see Step 10 above)
2. Restart the LaunchAgent after granting access
3. Verify with the test command in Step 10.4

**Checking logs for Messages errors:**
```bash
grep -i "messages\|chat.db\|sqlite" /tmp/macos-mcp.error.log
```

### Permission Issues

Several tools require specific macOS permissions. When running as a LaunchAgent (HTTP transport), permissions must be granted to the **node binary** rather than a terminal app since there is no terminal in the process chain.

**For Messages (Full Disk Access):**
1. Go to **System Settings** > **Privacy & Security** > **Full Disk Access**
2. Add the **node binary** used in your LaunchAgent (run `which node` to find the path)
3. Restart the LaunchAgent after granting access

See Step 10 for detailed instructions.

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
