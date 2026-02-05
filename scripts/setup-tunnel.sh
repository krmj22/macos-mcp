#!/bin/bash
#
# setup-tunnel.sh - Interactive Cloudflare Tunnel setup for macos-mcp
#
# This script guides you through creating a Cloudflare Tunnel and
# configuring it for use with the macos-mcp server.
#
# Usage: ./scripts/setup-tunnel.sh
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
CLOUDFLARED_DIR="$HOME/.cloudflared"
DEFAULT_PORT=3847
TUNNEL_NAME="macos-mcp"

#
# Helper functions
#

print_header() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

print_step() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[i]${NC} $1"
}

confirm() {
    local prompt="$1"
    local default="${2:-y}"

    if [[ "$default" == "y" ]]; then
        prompt="$prompt [Y/n]: "
    else
        prompt="$prompt [y/N]: "
    fi

    read -r -p "$prompt" response
    response="${response:-$default}"

    [[ "$response" =~ ^[Yy]$ ]]
}

#
# Prerequisite checks
#

check_prerequisites() {
    print_header "Checking Prerequisites"

    local missing=0

    # Check for cloudflared
    if command -v cloudflared &> /dev/null; then
        print_step "cloudflared is installed ($(cloudflared --version 2>&1 | head -1))"
    else
        print_error "cloudflared is not installed"
        echo "    Install with: brew install cloudflared"
        missing=1
    fi

    # Check for node
    if command -v node &> /dev/null; then
        print_step "Node.js is installed ($(node --version))"
    else
        print_error "Node.js is not installed"
        echo "    Install with: brew install node"
        missing=1
    fi

    # Check for project build
    local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local project_dir="$(dirname "$script_dir")"

    if [[ -f "$project_dir/dist/index.js" ]]; then
        print_step "macos-mcp is built ($project_dir/dist/index.js)"
    else
        print_error "macos-mcp is not built"
        echo "    Run: pnpm build"
        missing=1
    fi

    # Check macOS
    if [[ "$(uname)" == "Darwin" ]]; then
        print_step "Running on macOS ($(sw_vers -productVersion))"
    else
        print_error "This script requires macOS"
        missing=1
    fi

    if [[ $missing -eq 1 ]]; then
        echo ""
        print_error "Please install missing prerequisites and try again."
        exit 1
    fi

    echo ""
    print_step "All prerequisites met!"
}

#
# Cloudflare authentication
#

check_cloudflare_auth() {
    print_header "Cloudflare Authentication"

    if [[ -f "$CLOUDFLARED_DIR/cert.pem" ]]; then
        print_step "Cloudflare certificate found"
        print_info "Already authenticated with Cloudflare"
    else
        print_warning "Not authenticated with Cloudflare"
        echo ""
        echo "This will open your browser to log in to Cloudflare."
        echo ""

        if confirm "Authenticate with Cloudflare now?"; then
            cloudflared tunnel login

            if [[ -f "$CLOUDFLARED_DIR/cert.pem" ]]; then
                print_step "Authentication successful!"
            else
                print_error "Authentication failed"
                exit 1
            fi
        else
            print_error "Authentication required to continue"
            exit 1
        fi
    fi
}

#
# Tunnel creation
#

check_existing_tunnel() {
    if cloudflared tunnel list 2>/dev/null | grep -q "$TUNNEL_NAME"; then
        return 0
    fi
    return 1
}

get_tunnel_uuid() {
    cloudflared tunnel list 2>/dev/null | grep "$TUNNEL_NAME" | awk '{print $1}'
}

create_tunnel() {
    print_header "Tunnel Setup"

    if check_existing_tunnel; then
        local uuid=$(get_tunnel_uuid)
        print_step "Tunnel '$TUNNEL_NAME' already exists (UUID: $uuid)"

        if confirm "Use existing tunnel?" "y"; then
            TUNNEL_UUID="$uuid"
            return
        fi

        print_warning "Deleting existing tunnel..."
        cloudflared tunnel delete "$TUNNEL_NAME" 2>/dev/null || true
    fi

    echo "Creating new tunnel '$TUNNEL_NAME'..."
    echo ""

    local output=$(cloudflared tunnel create "$TUNNEL_NAME" 2>&1)
    echo "$output"

    TUNNEL_UUID=$(get_tunnel_uuid)

    if [[ -n "$TUNNEL_UUID" ]]; then
        print_step "Tunnel created successfully!"
        print_info "UUID: $TUNNEL_UUID"
    else
        print_error "Failed to create tunnel"
        exit 1
    fi
}

#
# Configuration
#

get_hostname() {
    print_header "Domain Configuration"

    echo "Enter the hostname for your MCP server."
    echo "Examples: mcp.yourdomain.com, macos-mcp.example.org"
    echo ""

    read -r -p "Hostname: " hostname

    if [[ -z "$hostname" ]]; then
        print_error "Hostname is required"
        exit 1
    fi

    # Basic validation
    if [[ ! "$hostname" =~ ^[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)+$ ]]; then
        print_warning "Hostname format looks unusual, but continuing..."
    fi

    HOSTNAME="$hostname"
    print_step "Hostname set to: $HOSTNAME"
}

create_config() {
    print_header "Creating Configuration"

    local config_file="$CLOUDFLARED_DIR/config.yml"
    local credentials_file="$CLOUDFLARED_DIR/$TUNNEL_UUID.json"

    # Check if credentials file exists
    if [[ ! -f "$credentials_file" ]]; then
        print_error "Credentials file not found: $credentials_file"
        exit 1
    fi

    # Backup existing config
    if [[ -f "$config_file" ]]; then
        local backup="$config_file.backup.$(date +%Y%m%d%H%M%S)"
        cp "$config_file" "$backup"
        print_info "Backed up existing config to: $backup"
    fi

    # Create new config
    cat > "$config_file" << EOF
# Cloudflare Tunnel configuration for macos-mcp
# Generated by setup-tunnel.sh on $(date)

tunnel: $TUNNEL_UUID
credentials-file: $credentials_file

ingress:
  - hostname: $HOSTNAME
    service: http://localhost:$DEFAULT_PORT
    originRequest:
      noTLSVerify: false
      connectTimeout: 30s

  - service: http_status:404
EOF

    print_step "Configuration written to: $config_file"
    echo ""
    echo "Contents:"
    echo "─────────────────────────────────────────"
    cat "$config_file"
    echo "─────────────────────────────────────────"
}

#
# DNS setup
#

setup_dns() {
    print_header "DNS Configuration"

    echo "This will create a CNAME record pointing $HOSTNAME to your tunnel."
    echo ""

    # Check if DNS record already exists
    if cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME" 2>&1 | grep -q "already exists"; then
        print_step "DNS record already exists for $HOSTNAME"
    else
        if confirm "Create DNS record now?"; then
            cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME"
            print_step "DNS record created!"
        else
            print_warning "Skipping DNS setup. Run manually:"
            echo "    cloudflared tunnel route dns $TUNNEL_NAME $HOSTNAME"
        fi
    fi
}

#
# Server configuration
#

create_server_config() {
    print_header "Server Configuration"

    local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local project_dir="$(dirname "$script_dir")"
    local config_file="$project_dir/macos-mcp.config.json"

    echo "To enable Cloudflare Access authentication, you need:"
    echo "  1. Team Domain (e.g., yourteam.cloudflareaccess.com)"
    echo "  2. Application Audience (AUD) tag"
    echo ""
    echo "Set these up in Cloudflare Zero Trust dashboard first."
    echo "See docs/CLOUDFLARE_SETUP.md for detailed instructions."
    echo ""

    if confirm "Configure Cloudflare Access now?" "n"; then
        read -r -p "Team Domain (e.g., yourteam or yourteam.cloudflareaccess.com): " team_domain
        read -r -p "Application AUD tag: " policy_aud
        read -r -p "Allowed email (optional, press Enter to skip): " allowed_email

        if [[ -z "$team_domain" ]] || [[ -z "$policy_aud" ]]; then
            print_warning "Skipping Cloudflare Access configuration"
            create_basic_server_config "$config_file"
        else
            create_full_server_config "$config_file" "$team_domain" "$policy_aud" "$allowed_email"
        fi
    else
        create_basic_server_config "$config_file"
        print_warning "Server will run without Cloudflare Access authentication!"
        print_warning "Do NOT expose to the internet until Access is configured."
    fi
}

create_basic_server_config() {
    local config_file="$1"

    cat > "$config_file" << EOF
{
  "transport": "http",
  "http": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": $DEFAULT_PORT
  }
}
EOF

    print_step "Basic server config written to: $config_file"
}

create_full_server_config() {
    local config_file="$1"
    local team_domain="$2"
    local policy_aud="$3"
    local allowed_email="$4"

    # Normalize team domain
    if [[ ! "$team_domain" == *.cloudflareaccess.com ]]; then
        team_domain="$team_domain.cloudflareaccess.com"
    fi

    if [[ -n "$allowed_email" ]]; then
        cat > "$config_file" << EOF
{
  "transport": "http",
  "http": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": $DEFAULT_PORT,
    "cloudflareAccess": {
      "teamDomain": "$team_domain",
      "policyAUD": "$policy_aud",
      "allowedEmails": ["$allowed_email"]
    }
  }
}
EOF
    else
        cat > "$config_file" << EOF
{
  "transport": "http",
  "http": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": $DEFAULT_PORT,
    "cloudflareAccess": {
      "teamDomain": "$team_domain",
      "policyAUD": "$policy_aud"
    }
  }
}
EOF
    fi

    print_step "Full server config written to: $config_file"
}

#
# LaunchAgent setup
#

create_launch_agents() {
    print_header "LaunchAgent Setup"

    echo "LaunchAgents allow the server and tunnel to start automatically on login."
    echo ""

    if ! confirm "Create LaunchAgents for auto-start?"; then
        print_info "Skipping LaunchAgent setup"
        return
    fi

    local launch_agents_dir="$HOME/Library/LaunchAgents"
    mkdir -p "$launch_agents_dir"

    local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local project_dir="$(dirname "$script_dir")"
    local node_path=$(which node)
    local cloudflared_path=$(which cloudflared)

    # Create macos-mcp LaunchAgent
    local mcp_plist="$launch_agents_dir/com.macos-mcp.server.plist"
    cat > "$mcp_plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.macos-mcp.server</string>

    <key>ProgramArguments</key>
    <array>
        <string>$node_path</string>
        <string>$project_dir/dist/index.js</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>/tmp/macos-mcp.log</string>

    <key>StandardErrorPath</key>
    <string>/tmp/macos-mcp.error.log</string>

    <key>WorkingDirectory</key>
    <string>$project_dir</string>
</dict>
</plist>
EOF

    print_step "Created: $mcp_plist"

    # Create cloudflared LaunchAgent
    local cf_plist="$launch_agents_dir/com.cloudflare.cloudflared.plist"
    cat > "$cf_plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.cloudflare.cloudflared</string>

    <key>ProgramArguments</key>
    <array>
        <string>$cloudflared_path</string>
        <string>tunnel</string>
        <string>run</string>
        <string>$TUNNEL_NAME</string>
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
EOF

    print_step "Created: $cf_plist"

    echo ""
    if confirm "Load LaunchAgents now?"; then
        launchctl load "$mcp_plist" 2>/dev/null || true
        launchctl load "$cf_plist" 2>/dev/null || true
        print_step "LaunchAgents loaded!"
    else
        print_info "Load manually with:"
        echo "    launchctl load $mcp_plist"
        echo "    launchctl load $cf_plist"
    fi
}

#
# Test connection
#

test_connection() {
    print_header "Testing Connection"

    echo "Starting test..."
    echo ""

    # Check if server is responding locally
    if curl -s -o /dev/null -w "%{http_code}" "http://localhost:$DEFAULT_PORT/health" 2>/dev/null | grep -q "200"; then
        print_step "Local server responding on port $DEFAULT_PORT"
    else
        print_warning "Local server not responding (may need to start it)"
    fi

    # Check tunnel status
    if cloudflared tunnel info "$TUNNEL_NAME" &>/dev/null; then
        print_step "Tunnel '$TUNNEL_NAME' exists"
    else
        print_warning "Tunnel info not available"
    fi

    echo ""
    print_info "To test the full setup:"
    echo "    1. Start the server: node dist/index.js"
    echo "    2. Start the tunnel: cloudflared tunnel run $TUNNEL_NAME"
    echo "    3. Visit: https://$HOSTNAME/health"
}

#
# Summary
#

print_summary() {
    print_header "Setup Complete!"

    local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local project_dir="$(dirname "$script_dir")"

    echo "Summary:"
    echo "────────────────────────────────────────────────────"
    echo "  Tunnel Name:    $TUNNEL_NAME"
    echo "  Tunnel UUID:    $TUNNEL_UUID"
    echo "  Hostname:       $HOSTNAME"
    echo "  Local Port:     $DEFAULT_PORT"
    echo "────────────────────────────────────────────────────"
    echo ""
    echo "Configuration files:"
    echo "  - Tunnel config:  $CLOUDFLARED_DIR/config.yml"
    echo "  - Server config:  $project_dir/macos-mcp.config.json"
    echo ""
    echo "Next steps:"
    echo "  1. Configure Cloudflare Access in Zero Trust dashboard"
    echo "     https://one.dash.cloudflare.com/"
    echo ""
    echo "  2. Update server config with Access credentials"
    echo "     Edit: $project_dir/macos-mcp.config.json"
    echo ""
    echo "  3. Start services (or they'll auto-start on login):"
    echo "     node $project_dir/dist/index.js"
    echo "     cloudflared tunnel run $TUNNEL_NAME"
    echo ""
    echo "  4. Test your setup:"
    echo "     curl https://$HOSTNAME/health"
    echo ""
    echo "Documentation: $project_dir/docs/CLOUDFLARE_SETUP.md"
}

#
# Main
#

main() {
    print_header "macos-mcp Cloudflare Tunnel Setup"

    echo "This script will help you set up a Cloudflare Tunnel for"
    echo "secure remote access to your macos-mcp server."
    echo ""
    echo "For detailed documentation, see: docs/CLOUDFLARE_SETUP.md"
    echo ""

    if ! confirm "Continue with setup?"; then
        echo "Setup cancelled."
        exit 0
    fi

    check_prerequisites
    check_cloudflare_auth
    create_tunnel
    get_hostname
    create_config
    setup_dns
    create_server_config
    create_launch_agents
    test_connection
    print_summary
}

# Run main function
main "$@"
