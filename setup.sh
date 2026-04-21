#!/bin/bash
# One-click setup script for Matthews CRM
# Run this once: bash setup.sh

set -e

echo "🔧 Resetting local files..."
git stash --include-untracked 2>/dev/null || true
git checkout claude/build-custom-crm-f4XpX
git pull origin claude/build-custom-crm-f4XpX --force

echo "📦 Installing dependencies..."
cd functions && npm install && cd ..

echo "🚀 Deploying everything..."
firebase deploy

echo "✅ Done! Your CRM and API are live."
echo "Health check: https://us-central1-tmc-crm-f3728.cloudfunctions.net/health"
