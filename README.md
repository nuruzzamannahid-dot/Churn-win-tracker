# Churn Win Tracker

Single-file static dashboard for the churn win-back campaign: 540 merchants
(311 churn / 229 inactive) split between the two KAMs, Ahmed Asif Rashid and
Nuruzzaman Nahid.

**Live:** https://churn-win-tracker.vercel.app

## Files

| Path | Purpose |
| --- | --- |
| `src/biz_data.json` | Raw merchant list — `[id, reason, name, phone]` |
| `src/template.html` | HTML/CSS/JS template with a `__DATA__` placeholder |
| `build.py` | Inlines the JSON into the template → `index.html` |
| `index.html` | Built, self-contained dashboard (this is what gets deployed) |
| `apps-script/` | Optional Google Apps Script backend for Google Sheet sync |
| `vercel.json` | `cleanUrls`, `trailingSlash`, cache headers |

## Build

```bash
python3 build.py     # rewrites index.html from src/template.html + src/biz_data.json
```

`index.html` is generated. Run the build and commit the result **before** pushing,
otherwise the deployed dashboard keeps showing the old data.

## Deploy

Production URL: https://churn-win-tracker.vercel.app
Vercel project: `churn-win-tracker` (team *Carrybee*)

### How it is currently wired

The Vercel account has no GitHub login connection, so the project cannot be linked
to this repository and builds cannot be triggered by pushes. Deployments are created
through the Vercel API instead; the project's build command fetches the prebuilt page
from this repo's `main` branch into the output directory:

```bash
mkdir -p public \
  && curl -fsSL -o public/index.html https://raw.githubusercontent.com/nuruzzamannahid-dot/Churn-win-tracker/main/index.html \
  && printf 'User-agent: *\nDisallow: /\n' > public/robots.txt
```

Output directory: `public`. Consequences: a redeploy always publishes whatever is on
`main` at that moment, and the build breaks if the repository stops being public.

### Switching to normal Git deploys (recommended)

1. In Vercel, connect your GitHub account (Vercel → Account Settings → Authentication /
   Login Connections → GitHub).
2. Project → Settings → Git → connect `nuruzzamannahid-dot/Churn-win-tracker`.
3. Set Framework Preset to **Other**, clear **Build Command** and **Output Directory**
   (leave defaults), then redeploy — every push to `main` will then publish the
   committed `index.html` with no build step.

The repo already works as a zero-config static site (`index.html` at the root), so
nothing else needs to change.
