#!/usr/bin/env bash
# One-shot: commit + push to GitHub, then deploy to Vercel.
# Usage:  ./deploy.sh https://github.com/<you>/churn-win-tracker.git
set -euo pipefail
REMOTE="${1:-}"
if [ -z "$REMOTE" ]; then
  echo "Usage: ./deploy.sh https://github.com/<you>/churn-win-tracker.git"
  exit 1
fi
python3 build.py
git init -q 2>/dev/null || true
git add .
git commit -m "Churn win tracker with Google Sheet sync" || echo "nothing new to commit"
git branch -M main
git remote remove origin 2>/dev/null || true
git remote add origin "$REMOTE"
git push -u origin main
echo
echo "Pushed. Next:"
echo "  Option A (auto-deploy): vercel.com/new -> Import Git Repository -> Deploy"
echo "  Option B (CLI):         npm i -g vercel && vercel --prod"
