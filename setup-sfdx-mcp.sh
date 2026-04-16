#!/usr/bin/env bash
# Setup script for Salesforce DX (SFDX) MCP Server with Claude Code
# Works on macOS and Linux. Windows users: use setup-sfdx-mcp.ps1

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { printf "${BLUE}==> %s${NC}\n" "$*"; }
ok()      { printf "${GREEN}✓ %s${NC}\n" "$*"; }
warn()    { printf "${YELLOW}! %s${NC}\n" "$*"; }
fail()    { printf "${RED}✗ %s${NC}\n" "$*"; exit 1; }

info "Salesforce DX MCP Server setup for Claude Code"
echo ""

# 1. Node.js check
info "Checking Node.js..."
if ! command -v node >/dev/null 2>&1; then
    fail "Node.js is not installed. Install from https://nodejs.org (v18+), then re-run this script."
fi
NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
    fail "Node.js $NODE_MAJOR detected; version 18 or higher is required."
fi
ok "Node.js $(node -v)"

# 2. npm check
info "Checking npm..."
command -v npm >/dev/null 2>&1 || fail "npm not found. It normally ships with Node.js."
ok "npm $(npm -v)"

# 3. Install Salesforce CLI
info "Checking Salesforce CLI..."
if command -v sf >/dev/null 2>&1; then
    ok "sf CLI already installed: $(sf --version | head -n1)"
else
    info "Installing @salesforce/cli globally (this may take a minute)..."
    npm install -g @salesforce/cli
    ok "sf CLI installed: $(sf --version | head -n1)"
fi

# 4. Authenticate Salesforce (if no default org yet)
info "Checking Salesforce authentication..."
if sf org list 2>/dev/null | grep -q "No results found"; then
    HAS_ORG=0
elif sf org list 2>/dev/null | grep -qE "(Alias|Username)"; then
    HAS_ORG=1
else
    HAS_ORG=0
fi

if [ "$HAS_ORG" -eq 0 ]; then
    warn "No Salesforce org connected yet."
    read -r -p "Log in to your Salesforce org now? [Y/n] " reply
    reply=${reply:-Y}
    if [[ "$reply" =~ ^[Yy]$ ]]; then
        read -r -p "Is this a sandbox? [y/N] " sb
        sb=${sb:-N}
        read -r -p "Alias for this org (e.g. MyOrg): " alias_name
        alias_name=${alias_name:-MyOrg}
        if [[ "$sb" =~ ^[Yy]$ ]]; then
            sf org login web --alias "$alias_name" --set-default --instance-url https://test.salesforce.com
        else
            sf org login web --alias "$alias_name" --set-default
        fi
    else
        warn "Skipping login. You can run 'sf org login web --alias <name> --set-default' later."
    fi
else
    ok "Found existing Salesforce org connection(s):"
    sf org list
fi

# 5. Write .mcp.json in the current directory
info "Writing .mcp.json for Claude Code..."
MCP_FILE="./.mcp.json"

SFDX_BLOCK='"salesforce": {
      "command": "npx",
      "args": [
        "-y",
        "@salesforce/mcp",
        "--orgs",
        "DEFAULT_TARGET_ORG",
        "--toolsets",
        "orgs,metadata,data,users"
      ]
    }'

if [ -f "$MCP_FILE" ]; then
    if grep -q "\"salesforce\"" "$MCP_FILE"; then
        warn "$MCP_FILE already has a 'salesforce' server entry — leaving it alone."
    else
        warn "$MCP_FILE exists. Please manually add this under mcpServers:"
        echo ""
        echo "    $SFDX_BLOCK"
        echo ""
    fi
else
    cat > "$MCP_FILE" <<'JSON'
{
  "mcpServers": {
    "salesforce": {
      "command": "npx",
      "args": [
        "-y",
        "@salesforce/mcp",
        "--orgs",
        "DEFAULT_TARGET_ORG",
        "--toolsets",
        "orgs,metadata,data,users"
      ]
    }
  }
}
JSON
    ok "Wrote $MCP_FILE"
fi

# 6. Prefetch the MCP package so the first Claude Code invocation is fast
info "Prefetching @salesforce/mcp package..."
npx -y @salesforce/mcp --help >/dev/null 2>&1 || warn "Prefetch returned non-zero; that's usually fine."
ok "Prefetch complete"

echo ""
ok "Setup complete."
echo ""
info "Next steps:"
echo "  1. Fully restart Claude Code (Desktop, VS Code, or CLI)"
echo "  2. Open a session in this directory: $(pwd)"
echo "  3. Ask Claude something like:"
echo "       \"Run SOQL: SELECT Id, Name FROM Account LIMIT 5\""
echo "  4. You should see Salesforce MCP tools appear and return data."
echo ""
info "Want multiple orgs? Edit .mcp.json and change --orgs arg to a comma-separated list of aliases,"
info "e.g. \"--orgs\", \"ProdOrg,SandboxOrg\""
