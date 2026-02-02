#!/bin/bash

# macOS permission check script for macos-mcp
# Verifies EventKit and AppleScript automation permissions

echo "🔐 Checking macos-mcp permissions..."

# Check EventKit permissions
echo "📅 Checking EventKit (Reminders) permissions..."
EVENTKIT_CHECK=$(./bin/EventKitCLI --action read --limit 1 2>&1)
if [[ $? -eq 0 ]]; then
    echo "✅ EventKit permissions granted"
else
    echo "❌ EventKit permissions denied or not yet authorized"
    echo "Please grant access in System Settings > Privacy & Security > Reminders"
    echo "Re-run this script after granting permission"
    exit 1
fi

# Check AppleScript automation permissions
echo "🤖 Checking AppleScript automation permissions..."
APPLESCRIPT_CHECK=$(osascript -e 'tell application "Reminders" to get the name of every list' 2>&1)
if [[ $? -eq 0 ]]; then
    echo "✅ AppleScript automation permissions granted"
    echo "Available reminder lists: $APPLESCRIPT_CHECK"
else
    echo "❌ AppleScript automation permissions denied or not yet authorized"
    echo "Please grant access in System Settings > Privacy & Security > Automation"
    echo "Re-run this script after granting permission"
    exit 1
fi

echo ""
echo "🎉 All permission checks passed!"
echo "📱 macos-mcp is ready to run"
echo ""
echo "Start command: macos-mcp"
