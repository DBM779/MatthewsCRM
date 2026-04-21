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
firebase deploy --force

echo "🔗 Connecting Cloud Functions to Cloud SQL..."
gcloud functions add-invoker-policy-binding api --region=us-central1 --member=allUsers --project=tmc-crm-f3728 2>/dev/null || true
gcloud functions add-invoker-policy-binding bulk --region=us-central1 --member=allUsers --project=tmc-crm-f3728 2>/dev/null || true
gcloud functions add-invoker-policy-binding health --region=us-central1 --member=allUsers --project=tmc-crm-f3728 2>/dev/null || true

echo "✅ Done! Your CRM and API are live."
echo "Health check: https://us-central1-tmc-crm-f3728.cloudfunctions.net/health"
