#!/bin/bash
#
# End-to-end test script for macos-mcp HTTP transport
#
# Tests the full stack from HTTP request to response:
# - Health endpoints
# - Server startup/shutdown
# - Basic connectivity
#
# Usage: ./scripts/test-e2e.sh
#
# Requirements:
# - Node.js 18+
# - Built project (pnpm build)
# - jq for JSON parsing
#
# Exit codes:
# - 0: All tests passed
# - 1: Test failure
# - 2: Setup failure

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
PORT="${MCP_HTTP_PORT:-3847}"
HOST="${MCP_HTTP_HOST:-127.0.0.1}"
BASE_URL="http://${HOST}:${PORT}"
TIMEOUT=30
SERVER_PID=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Cleanup function
cleanup() {
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        echo -e "${YELLOW}Stopping server (PID: $SERVER_PID)...${NC}"
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
}

# Set trap for cleanup on exit
trap cleanup EXIT INT TERM

# Print test result
print_result() {
    local test_name="$1"
    local result="$2"
    if [ "$result" = "pass" ]; then
        echo -e "  ${GREEN}[PASS]${NC} $test_name"
    else
        echo -e "  ${RED}[FAIL]${NC} $test_name"
        return 1
    fi
}

# Wait for server to be ready
wait_for_server() {
    local max_attempts=30
    local attempt=0

    echo "Waiting for server to start..."
    while [ $attempt -lt $max_attempts ]; do
        if curl -s "${BASE_URL}/health" > /dev/null 2>&1; then
            echo -e "${GREEN}Server is ready!${NC}"
            return 0
        fi
        attempt=$((attempt + 1))
        sleep 1
    done

    echo -e "${RED}Server failed to start within ${max_attempts} seconds${NC}"
    return 1
}

# Check prerequisites
check_prerequisites() {
    echo "Checking prerequisites..."

    # Check Node.js
    if ! command -v node &> /dev/null; then
        echo -e "${RED}Error: Node.js not found${NC}"
        exit 2
    fi

    # Check jq
    if ! command -v jq &> /dev/null; then
        echo -e "${RED}Error: jq not found. Install with: brew install jq${NC}"
        exit 2
    fi

    # Check if built
    if [ ! -f "${PROJECT_ROOT}/dist/index.js" ]; then
        echo -e "${RED}Error: Project not built. Run: pnpm build${NC}"
        exit 2
    fi

    # Check if port is available
    if lsof -i ":${PORT}" > /dev/null 2>&1; then
        echo -e "${RED}Error: Port ${PORT} is already in use${NC}"
        exit 2
    fi

    echo -e "${GREEN}Prerequisites OK${NC}"
}

# Start the server
start_server() {
    echo "Starting server on ${HOST}:${PORT}..."

    cd "$PROJECT_ROOT"

    # Start server in HTTP mode
    MCP_TRANSPORT=http \
    MCP_HTTP_ENABLED=true \
    MCP_HTTP_HOST="$HOST" \
    MCP_HTTP_PORT="$PORT" \
    node dist/index.js 2>&1 &

    SERVER_PID=$!

    echo "Server started with PID: $SERVER_PID"

    # Wait for server to be ready
    if ! wait_for_server; then
        echo -e "${RED}Server startup failed${NC}"
        exit 1
    fi
}

# Test: Health endpoint
test_health() {
    echo ""
    echo "Testing health endpoint..."

    local response
    response=$(curl -s "${BASE_URL}/health")

    # Check status is healthy
    if echo "$response" | jq -e '.status == "healthy"' > /dev/null 2>&1; then
        print_result "Health status is 'healthy'" "pass"
    else
        print_result "Health status is 'healthy'" "fail"
        return 1
    fi

    # Check service name
    if echo "$response" | jq -e '.service == "macos-mcp"' > /dev/null 2>&1; then
        print_result "Service name is 'macos-mcp'" "pass"
    else
        print_result "Service name is 'macos-mcp'" "fail"
        return 1
    fi

    # Check timestamp exists
    if echo "$response" | jq -e '.timestamp' > /dev/null 2>&1; then
        print_result "Timestamp is present" "pass"
    else
        print_result "Timestamp is present" "fail"
        return 1
    fi

    # Check uptime exists and is non-negative
    if echo "$response" | jq -e '.uptime >= 0' > /dev/null 2>&1; then
        print_result "Uptime is non-negative" "pass"
    else
        print_result "Uptime is non-negative" "fail"
        return 1
    fi
}

# Test: Readiness endpoint
test_readiness() {
    echo ""
    echo "Testing readiness endpoint..."

    local response
    response=$(curl -s "${BASE_URL}/health/ready")

    # Check status is healthy
    if echo "$response" | jq -e '.status == "healthy"' > /dev/null 2>&1; then
        print_result "Readiness status is 'healthy'" "pass"
    else
        print_result "Readiness status is 'healthy'" "fail"
        return 1
    fi

    # Check subsystems exist
    if echo "$response" | jq -e '.subsystems | length > 0' > /dev/null 2>&1; then
        print_result "Subsystems array is present" "pass"
    else
        print_result "Subsystems array is present" "fail"
        return 1
    fi

    # Check MCP server subsystem
    if echo "$response" | jq -e '.subsystems[] | select(.name == "mcp-server") | .status == "healthy"' > /dev/null 2>&1; then
        print_result "MCP server subsystem is healthy" "pass"
    else
        print_result "MCP server subsystem is healthy" "fail"
        return 1
    fi

    # Check HTTP transport subsystem
    if echo "$response" | jq -e '.subsystems[] | select(.name == "http-transport") | .status == "healthy"' > /dev/null 2>&1; then
        print_result "HTTP transport subsystem is healthy" "pass"
    else
        print_result "HTTP transport subsystem is healthy" "fail"
        return 1
    fi
}

# Test: CORS headers
test_cors() {
    echo ""
    echo "Testing CORS headers..."

    local response
    response=$(curl -s -I "${BASE_URL}/health")

    # Check Access-Control-Allow-Origin
    if echo "$response" | grep -qi "access-control-allow-origin"; then
        print_result "Access-Control-Allow-Origin header present" "pass"
    else
        print_result "Access-Control-Allow-Origin header present" "fail"
        return 1
    fi
}

# Test: OPTIONS preflight
test_options_preflight() {
    echo ""
    echo "Testing OPTIONS preflight..."

    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS "${BASE_URL}/health")

    if [ "$http_code" = "204" ]; then
        print_result "OPTIONS returns 204" "pass"
    else
        print_result "OPTIONS returns 204 (got $http_code)" "fail"
        return 1
    fi
}

# Test: MCP endpoint exists (without auth, should work in local mode)
test_mcp_endpoint() {
    echo ""
    echo "Testing MCP endpoint..."

    # Without Cloudflare Access configured, MCP endpoint should be accessible
    # We just test that it responds (even if with an error for invalid MCP request)
    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/mcp" \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}')

    # Should not be 404 (endpoint exists)
    if [ "$http_code" != "404" ]; then
        print_result "MCP endpoint exists (HTTP $http_code)" "pass"
    else
        print_result "MCP endpoint exists" "fail"
        return 1
    fi
}

# Test: Rate limit headers
test_rate_limit_headers() {
    echo ""
    echo "Testing rate limit headers..."

    # Use -D to capture headers while also getting body
    local headers
    headers=$(curl -s -D - "${BASE_URL}/mcp" -X POST -H "Content-Type: application/json" -d '{}' -o /dev/null)

    # Check RateLimit-Limit header
    if echo "$headers" | grep -qi "ratelimit-limit"; then
        print_result "RateLimit-Limit header present" "pass"
    else
        print_result "RateLimit-Limit header present" "fail"
        return 1
    fi
}

# Test: Server graceful shutdown
test_graceful_shutdown() {
    echo ""
    echo "Testing graceful shutdown..."

    # Send SIGTERM
    kill -TERM "$SERVER_PID" 2>/dev/null || true

    # Wait for process to exit (max 5 seconds)
    local count=0
    while kill -0 "$SERVER_PID" 2>/dev/null && [ $count -lt 5 ]; do
        sleep 1
        count=$((count + 1))
    done

    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        print_result "Server shut down gracefully" "pass"
        SERVER_PID="" # Clear PID since server is stopped
    else
        print_result "Server shut down gracefully" "fail"
        return 1
    fi
}

# Main test runner
main() {
    echo "========================================"
    echo "  macos-mcp E2E Tests"
    echo "========================================"
    echo ""

    local failed=0

    check_prerequisites
    start_server

    # Run tests
    test_health || failed=1
    test_readiness || failed=1
    test_cors || failed=1
    test_options_preflight || failed=1
    test_mcp_endpoint || failed=1
    test_rate_limit_headers || failed=1
    test_graceful_shutdown || failed=1

    echo ""
    echo "========================================"
    if [ $failed -eq 0 ]; then
        echo -e "  ${GREEN}All E2E tests passed!${NC}"
    else
        echo -e "  ${RED}Some E2E tests failed${NC}"
    fi
    echo "========================================"

    exit $failed
}

# Run main
main "$@"
