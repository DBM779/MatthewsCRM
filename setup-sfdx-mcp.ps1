# Setup script for Salesforce DX (SFDX) MCP Server with Claude Code
# Windows PowerShell version. macOS/Linux: use setup-sfdx-mcp.sh
# Run from PowerShell: .\setup-sfdx-mcp.ps1

$ErrorActionPreference = "Stop"

function Info($msg) { Write-Host "==> $msg" -ForegroundColor Blue }
function Ok($msg)   { Write-Host "✓ $msg"   -ForegroundColor Green }
function Warn($msg) { Write-Host "! $msg"   -ForegroundColor Yellow }
function Fail($msg) { Write-Host "✗ $msg"   -ForegroundColor Red; exit 1 }

Info "Salesforce DX MCP Server setup for Claude Code"
Write-Host ""

# 1. Node.js check
Info "Checking Node.js..."
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "Node.js is not installed. Install from https://nodejs.org (v18+), then re-run." }
$nodeVer = (& node -v).TrimStart('v').Split('.')[0]
if ([int]$nodeVer -lt 18) { Fail "Node.js $nodeVer detected; version 18 or higher is required." }
Ok "Node.js $(& node -v)"

# 2. npm check
Info "Checking npm..."
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail "npm not found. It normally ships with Node.js." }
Ok "npm $(& npm -v)"

# 3. Salesforce CLI
Info "Checking Salesforce CLI..."
$sf = Get-Command sf -ErrorAction SilentlyContinue
if ($sf) {
    Ok "sf CLI already installed: $((& sf --version) -split "`n" | Select-Object -First 1)"
} else {
    Info "Installing @salesforce/cli globally (this may take a minute)..."
    npm install -g @salesforce/cli
    Ok "sf CLI installed"
}

# 4. Salesforce auth
Info "Checking Salesforce authentication..."
$orgListOutput = (& sf org list 2>&1 | Out-String)
$hasOrg = $false
if ($orgListOutput -match "Alias|Username") { $hasOrg = $true }

if (-not $hasOrg) {
    Warn "No Salesforce org connected yet."
    $reply = Read-Host "Log in to your Salesforce org now? [Y/n]"
    if (-not $reply) { $reply = "Y" }
    if ($reply -match "^[Yy]") {
        $sb    = Read-Host "Is this a sandbox? [y/N]"
        if (-not $sb) { $sb = "N" }
        $alias = Read-Host "Alias for this org (e.g. MyOrg)"
        if (-not $alias) { $alias = "MyOrg" }
        if ($sb -match "^[Yy]") {
            & sf org login web --alias $alias --set-default --instance-url https://test.salesforce.com
        } else {
            & sf org login web --alias $alias --set-default
        }
    } else {
        Warn "Skipping login. Run 'sf org login web --alias <name> --set-default' later."
    }
} else {
    Ok "Found existing Salesforce org connection(s):"
    & sf org list
}

# 5. Write .mcp.json
Info "Writing .mcp.json for Claude Code..."
$mcpFile = ".\.mcp.json"
$mcpJson = @'
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
'@

if (Test-Path $mcpFile) {
    $existing = Get-Content $mcpFile -Raw
    if ($existing -match '"salesforce"') {
        Warn "$mcpFile already has a 'salesforce' server entry — leaving it alone."
    } else {
        Warn "$mcpFile exists. Please manually add the salesforce server entry."
        Write-Host $mcpJson
    }
} else {
    Set-Content -Path $mcpFile -Value $mcpJson -Encoding UTF8
    Ok "Wrote $mcpFile"
}

# 6. Prefetch
Info "Prefetching @salesforce/mcp package..."
try { & npx -y "@salesforce/mcp" --help 2>&1 | Out-Null } catch {}
Ok "Prefetch complete"

Write-Host ""
Ok "Setup complete."
Write-Host ""
Info "Next steps:"
Write-Host "  1. Fully restart Claude Code (Desktop, VS Code, or CLI)"
Write-Host "  2. Open a session in this directory: $((Get-Location).Path)"
Write-Host "  3. Ask Claude:  Run SOQL: SELECT Id, Name FROM Account LIMIT 5"
Write-Host "  4. You should see Salesforce MCP tools return data."
Write-Host ""
Info "Multiple orgs? Edit .mcp.json --orgs to a comma-separated list (e.g. ProdOrg,SandboxOrg)"
