# Drive Organizer V3

AI-powered Google Drive organization, built on Google Apps Script + the Claude API. Runs entirely inside a Google Sheets spreadsheet — no servers, no installs.

## What it does

Scans your entire Drive, classifies folders and files with AI, and proposes a complete organization plan you review before anything moves. Every executed change is logged and reversible with one click.

- **Folders first** — coherent folders (a shoot, a course, a client project) move intact as whole units, preserving your existing structure
- **Content-aware classification** — reads the first ~300 characters of Google Docs, Sheets, and Slides instead of guessing from file names
- **Triage before filing** — every file is sorted KEEP / DELETE-candidate / REVIEW; deletion candidates are staged for your review, never auto-deleted
- **Graduated confidence** — 85%+ proposals default to approved, 60–84% wait for your opt-in, below 60% routes straight to a review folder
- **Undo Last Run** — every move and rename is logged with a run ID; one menu click reverses the most recent execution
- **Two rename modes** — mechanical formatting fixes apply automatically; AI-suggested renames go through an approval queue
- **Duplicate detector** — finds exact name+size matches and "Copy of" patterns with zero API calls; approved duplicates are staged for review, never deleted
- **Post-run summary** — a branded handoff report showing what moved where, per-pillar distribution, and the review-folder homework
- **Inbox workflow** — drop new files into a TO_ORGANIZE folder and a weekly scan classifies and routes them

## Setup

1. Create a Google Sheets spreadsheet named `DRIVE_ORGANIZER_CONTROL`
2. Extensions → Apps Script → delete the placeholder → paste `drive-organizer-apps-script.gs`
3. Save, reload the spreadsheet, authorize when prompted
4. Set your Claude API key and root folder from the menu: **Setup: Set API Key** and **Setup: Set Root Folder** (stored in user properties — survives script updates)
5. Run the passes in order from the **Drive Organizer** menu

Full setup and client workflow instructions live in the deployment guide.

## Pass sequence

| Pass | What it does | API calls |
|------|--------------|-----------|
| 1 | Full inventory scan | None |
| 2A | Classify folders as intact units | Light |
| 2B | Classify files (content-aware, triaged) | Yes |
| 2C | Build the organization plan | None |
| 3 | Execute approved changes (logged for undo) | None |
| 4 | Rename: mechanical + AI-suggested with approval | Mode B only |

## Requirements

- Google account with Drive + Sheets
- Anthropic API key with credits ([console.anthropic.com](https://console.anthropic.com))
- Default model: `claude-sonnet-5` (configurable near the top of the script)

## Cost

Roughly $3–6 for a full first-time run on a messy 1,000-file drive. Passes 1, 2C, and 3 are free (no API calls).

---

Part of the MILO.LIFE.OS system.
