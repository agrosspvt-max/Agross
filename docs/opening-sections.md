# Job openings with sections and formatting

Recruiting > Create opening and Edit opening let admins write the main description and any number of named sections
(each with a heading and a description), with Bold and Italic. The Join Us page shows the main description first, then
each section in the order it was added.

## Behaviour

- **Editor:** Designation, Area (optional), Description, then **+ Add section** (as many as needed), then Status. Each
  section has a Section heading, a Section description and Remove section. The Description, every heading and every
  section description have Bold and Italic buttons (also Ctrl/Cmd+B and Ctrl/Cmd+I, and the phone's own format menu).
  They format the selected word, phrase, line or paragraph, and with nothing selected they apply to what is typed next.
  The buttons are real buttons: they work with Tab and Enter, and they are 44 px on a phone.
- **Headings start bold.** Bold switches the selected part of a heading to regular weight and back; Italic is
  independent, so the same text can be both.
- **Paragraphs and line breaks:** Enter starts a paragraph, Shift+Enter a line break. Both are kept when an opening is
  saved and reopened and are shown on the public page. Pasted text is inserted as plain text.
- **Saving:** completely empty sections are left out. A section with only a heading, or only a description, is reported
  next to that section and field ("Add a description for this section.") and everything typed stays in the form.
- **Public page:** the openings list shows a short plain-text excerpt (about 200 characters) of the main description.
  The opening page shows the main description, then each section's heading and text in order, with bold, italic,
  paragraphs and line breaks. Closed openings are hidden everywhere, as before. Existing openings with only a plain
  description show it exactly as before; nothing needs converting.
- **Permissions:** unchanged. Saving needs the recruiting permission, checked on the server.

## How text is stored, and why it is safe

Formatted text is stored as data, not HTML: paragraphs of text runs, `{ "t": "text", "b": true, "i": true }`, where `t`
may contain line breaks. The server accepts only that shape (text, true/false for bold and italic; anything else is
refused or dropped), checks lengths and unsupported characters, and the public page builds the page with text nodes and
a few fixed elements (`p`, `h2`, `strong`, `em`, `br`). Nothing is ever parsed as HTML, so `<script>` or `<img onerror=...>`
typed or pasted into any field is simply shown as those characters. Limits: main description and each section
description 5,000 characters, heading 120, 30 sections, 100 paragraphs per text.

The plain-text `description` column keeps a plain copy of the main description. It feeds the list excerpt and keeps
older code and cached pages working. If it ever disagrees with the formatted copy (an edit made by an older version),
the plain text wins.

## Rollout

Migration: **`db/migrations/011_opening_sections.sql`** (adds `intro` and `sections` to `job_openings`; nothing else
changes and no existing row is touched). Order: **migrate first, then deploy.** The previous code ignores the new
columns, so it keeps listing and saving openings in between; the new code needs the columns.

If migrations 009 or 010 are still pending in production, apply them first with their own commands from
`docs/catalogue-positions-rollout.md` and `docs/recruitment-bin.md`: this command refuses to run unless only 011 is pending.

```bash
cd /Users/rahmani/Documents/Claude/Projects/agross

(
  read -rs 'agross_neon_url?Paste your production Neon connection URL and press Enter: '
  printf '\n'
  [[ -n "$agross_neon_url" ]] || { echo 'No URL entered. Nothing was changed.'; exit 1; }
  q() { psql "$agross_neon_url" -X -v ON_ERROR_STOP=1 -tA -c "$1"; }

  applied=$(q 'SELECT name FROM schema_migrations') || { echo 'Could not read the applied migrations. Nothing was changed.'; exit 1; }
  pending=()
  for f in db/migrations/*(.); do
    print -r -- "$applied" | grep -qxF -- "${f:t}" || pending+=("${f:t}")
  done
  echo "Pending: ${pending[*]:-none}"
  if [[ "${pending[*]}" != '011_opening_sections.sql' ]]; then
    echo 'Expected only 011_opening_sections.sql to be pending. Nothing was changed. If an earlier migration is pending, apply it first with its own command.'
    exit 1
  fi

  before=$(q "SELECT count(*) || ' openings, ' || count(*) FILTER (WHERE is_open) || ' open' FROM job_openings") || exit 1
  echo "Before: $before"

  DATABASE_URL="$agross_neon_url" node scripts/migrate.js || exit 1

  after=$(q "SELECT count(*) || ' openings, ' || count(*) FILTER (WHERE is_open) || ' open' FROM job_openings")
  with_sections=$(q "SELECT count(*) FROM job_openings WHERE jsonb_array_length(sections) > 0")
  echo "After:  $after, $with_sections with sections"
  if [[ "$before" == "$after" && "$with_sections" == 0 ]]; then
    echo 'Check passed: every opening is unchanged and still readable. Next: deploy.'
  else
    echo 'Check FAILED. Send this output to Claude before deploying.'
  fi
)
```

After the deploy: open Recruiting, edit one open posting (its description should appear unchanged), add a section and
save; open that posting on Join Us and check the heading, text and formatting; close it and check it disappears.

## Rolling back

`db/rollback/011_opening_sections_down.sql` removes the two columns and the migration record in one transaction. Every
opening keeps its designation, area, status and plain description; the bold and italic formatting and the sections
are removed, so the script first lists which openings have sections. Run it, then deploy the previous version:

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f db/rollback/011_opening_sections_down.sql
```
