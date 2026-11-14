# Rolling out exact catalogue positions (migration 009)

Migration `009_catalogue_positions.js` gives every product live in a grid a position (1, 2, 3 ...) in the All tab of
its grid, and removes `display_order` from product content. It was verified and rehearsed, including the rollback, on
isolated local databases. It has **not** been applied to production.

## What it changes

- `products` gets `grid_position`, `requested_position` and a generated `grid_page` column, plus two constraints
  (one position per product in a grid, no two products at the same place).
- Positions are the order visitors see today. The order is worked out in JavaScript, the way the old listing page did
  it, because a database orders tied names differently (case, accents, punctuation).
- A position saved in a draft (an old unpublished "Display order" change) becomes a requested position. Drafts with
  other edits keep them.
- Nothing else is touched: enquiries, applications, résumés, notification history, admin accounts, audit log, product
  history and images.

## Production sequence

Do this at a quiet time. Nothing here has been run yet; each step needs your go-ahead.

1. **Read-only check of what the switch-off window shows** (see "What visitors see" below). Optional, safe to run.
2. **Record the public pages as they are now** (the catalogue is on, so this must say `managed`):
   ```bash
   node scripts/public-order.js capture https://www.agross.in before.json
   ```
3. **Switch the managed catalogue off:** Admin > Products > "Switch back to the original pages". Wait two minutes for
   cached pages to expire, then confirm: `curl -sI https://www.agross.in/chemicals.html | grep -i x-catalogue` shows
   `original`. **Do not publish, archive or restore anything from here until step 7.**
4. **Apply the migration** with the one-block command in the next section. It refuses to run while the catalogue is on,
   or if anything other than 009 is pending, and checks that every grid is numbered 1 to N afterwards.
5. **Deploy** (merge, push `main`). Wait until Vercel shows the new commit as Ready.
6. **Switch the managed catalogue on:** Admin > Products. Wait two minutes.
7. **Compare the public pages with step 2:**
   ```bash
   node scripts/public-order.js capture https://www.agross.in after.json
   node scripts/public-order.js compare before.json after.json
   ```
   It must print `IDENTICAL`. It compares every card in All and every tab on both pages (order, link, name, picture)
   and checks that each tab is All filtered. Then open a product page, open a product in Admin and confirm the field
   "Position in All products" shows its place, and check Products > "Unpublished changes" for moves listed in step 4.

If step 4's database check fails, or step 7 does not print `IDENTICAL`, use the rollback below.

### The migration command

```bash
cd /Users/rahmani/Documents/Claude/Projects/agross

(
  read -rs 'agross_neon_url?Paste your production Neon connection URL and press Enter: '
  printf '\n'
  [[ -n "$agross_neon_url" ]] || { echo 'No URL entered. Nothing was changed.'; exit 1; }
  q() { psql "$agross_neon_url" -X -v ON_ERROR_STOP=1 -tA -c "$1"; }

  live=$(q "SELECT value FROM app_settings WHERE key = 'catalogue_live'") || { echo 'Could not read the catalogue setting. Nothing was changed.'; exit 1; }
  if [[ "$live" != false ]]; then
    echo "The managed catalogue is switched ON (value: $live). Switch it off in Admin > Products first. Nothing was changed."
    exit 1
  fi

  applied=$(q 'SELECT name FROM schema_migrations') || { echo 'Could not read the applied migrations. Nothing was changed.'; exit 1; }
  pending=()
  for f in db/migrations/*(.); do
    print -r -- "$applied" | grep -qxF -- "${f:t}" || pending+=("${f:t}")
  done
  echo "Pending: ${pending[*]:-none}"
  if [[ "${pending[*]}" != '009_catalogue_positions.js' ]]; then
    echo 'Expected only 009_catalogue_positions.js to be pending. Nothing was changed.'
    exit 1
  fi

  in_grids=$(q "SELECT count(*) FROM products WHERE status = 'published' AND published->>'listing_page' IS NOT NULL") || exit 1
  products=$(q 'SELECT count(*) FROM products') || exit 1
  echo "Before: $products products, $in_grids published in the grids."

  DATABASE_URL="$agross_neon_url" node scripts/migrate.js || exit 1

  q "SELECT grid_page AS grid, count(*) AS products, min(grid_position) AS first, max(grid_position) AS last FROM products WHERE grid_page IS NOT NULL GROUP BY 1 ORDER BY 1" | sed 's/|/  /g'
  gaps=$(q "SELECT count(*) FROM (SELECT grid_position, row_number() OVER (PARTITION BY grid_page ORDER BY grid_position) AS n FROM products WHERE grid_page IS NOT NULL) s WHERE grid_position <> n")
  placed=$(q "SELECT count(*) FROM products WHERE grid_page IS NOT NULL")
  echo "Pending moves kept as requested positions: $(q 'SELECT count(*) FROM products WHERE requested_position IS NOT NULL')"
  if [[ "$gaps" == 0 && "$placed" == "$in_grids" && "$(q 'SELECT count(*) FROM products')" == "$products" ]]; then
    echo 'Database check passed: every product keeps its row, and each grid is numbered 1 to N with no gaps.'
    echo 'Next: deploy, switch the catalogue on, then compare the public pages with scripts/public-order.js.'
  else
    echo 'Database check FAILED. Do not deploy. Send this output to Claude.'
  fi
)
```

## What visitors see while the catalogue is off (steps 3 to 6)

Visitors get the **original** pages and data: `chemicals.html` and `nonchemical.html` as they were before the managed
catalogue, and the detail pages read `chemical.json` and `nonchemical.json`. `/api/catalogue` answers `{"live":false}`.
So during the window they see:

- products renamed or given a new picture in Admin with their **original** name and picture (for example RED BULL with
  `products/RedBull.png`, where the managed catalogue may show a new name and an uploaded picture);
- spelling differences that already exist between the original pages and the managed names (for example `MAXX CURE`
  against `MAXX-CURE`);
- products added or restored in the editor missing, and products archived in the editor still shown;
- the original order, ignoring any reordering done in Admin.

Enquiry, contact and application forms, and the Brevo emails, are not affected. The window is the time between
steps 3 and 6, normally a few minutes plus the two-minute cache waits. This read-only query counts what differs on
production; run it before step 3 and decide if the window is acceptable:

```sql
SELECT
  count(*) FILTER (WHERE p.status = 'published' AND r.id IS NULL)                                     AS added_in_editor_not_on_original,
  count(*) FILTER (WHERE p.status = 'published' AND r.id IS NOT NULL AND r.content->>'name' IS DISTINCT FROM p.published->>'name') AS renamed_in_editor,
  count(*) FILTER (WHERE p.status = 'published' AND r.id IS NOT NULL AND (p.published->>'image_id' IS NOT NULL
                    OR r.content->>'image' IS DISTINCT FROM p.published->>'image'))                    AS new_picture_in_editor,
  count(*) FILTER (WHERE p.status = 'archived' AND r.id IS NOT NULL)                                  AS archived_but_on_original
FROM products p LEFT JOIN product_revisions r ON r.product_id = p.id AND r.revision_no = 1 AND r.action = 'imported';
```

Why the catalogue is switched off rather than left on: between the migration and the deploy, the previous code would
keep serving the grids but ignore positions (display_order is gone), so visitors would see them sorted by name.
Publishing or archiving with the previous code would also fail on the new constraints.

## Rollback

Use it if the database check fails, the comparison is not `IDENTICAL`, or Admin misbehaves. It is a script, not a
snapshot restore, and it changes only the `products` table, the catalogue version and the migration record, in one
transaction.

1. **Switch the catalogue off** (Admin > Products). If Admin is unreachable, run this in the Neon SQL editor, then wait
   two minutes:
   ```sql
   UPDATE app_settings SET value = 'false', updated_at = now() WHERE key = 'catalogue_live';
   UPDATE app_settings SET value = to_jsonb((value #>> '{}')::int + 1), updated_at = now() WHERE key = 'catalogue_version';
   ```
2. **Run the rollback.** It refuses while the catalogue is on or if 009 is not recorded, and lists any pending position
   requests before it changes anything (copy that list):
   ```bash
   cd /Users/rahmani/Documents/Claude/Projects/agross

   (
     read -rs 'agross_neon_url?Paste your production Neon connection URL and press Enter: '
     printf '\n'
     [[ -n "$agross_neon_url" ]] || { echo 'No URL entered. Nothing was changed.'; exit 1; }
     psql "$agross_neon_url" -X -v ON_ERROR_STOP=1 -f db/rollback/009_catalogue_positions_down.sql
   )
   ```
   The migration record `009_catalogue_positions.js` is deleted in the same transaction, so the record matches the
   schema and a later `node scripts/migrate.js` applies 009 again cleanly.
3. **Deploy the previous version:** in Vercel, redeploy the previous production deployment, or `git revert` the merge
   and push. Note the current production deployment in Vercel before step 5 of the sequence.
4. **Switch the catalogue on** and compare with the recording from step 2: `compare before.json after.json` must print
   `IDENTICAL`.

### What the rollback keeps, and what to reapply

Kept, as tested after publishing a swap, saving an unpublished move and an unpublished name edit, publishing a new
product at #2, archiving one, and receiving an enquiry and an application with a résumé:

- the public order of both grids (the swap stays swapped; new products and archived products stay as they are);
- every published name, picture and field, product IDs and links;
- unpublished drafts and their edits;
- product history, the audit log (plus one rollback entry), images, enquiries, applications, résumés and notification
  history, admin accounts and sessions.

Not restored exactly, and to reapply if it matters:

- **Pending position requests.** The old model has no swap. A request for place N is saved as a draft sort value of
  `N x 10 - 5`, which places the product just before whatever is at N. Check them in the list the script prints. They
  show in the old editor as "Unpublished changes".
- **The original sort values.** Positions replace them as 10, 20, 30 ... in the same order. Ties and blanks that
  JavaScript resolved by name are now fixed in place.
- **Products with no position** (archived, not listed, never published) have no sort value; an archived product comes
  back at the end of its grid if it is restored later.
- Open editors are asked to reload (every product's version increases).

### If only a database snapshot restore is possible

Restoring a Neon branch or point-in-time copy from before the migration returns the **whole database** to that moment.
Everything written afterwards is lost: enquiries, applications and résumés submitted through the public forms, Brevo
delivery updates, admin sign-ins, audit entries, and any product edits. If you ever need this, first export what was
created since the snapshot (for example `\copy (SELECT * FROM enquiries WHERE created_at > '<time>') TO ...`, and the
same for `enquiry_resumes` and `notification_jobs` through their enquiry IDs) and reinsert it afterwards. The rollback
script avoids all of this and is the recommended route.

## Known limits

- The migration orders with `localeCompare('en-US')`. The old page used the server's default locale; on Vercel that
  is expected to be en-US. The before/after comparison in step 7 is the real check, and the rollback is ready if it
  differs.
- Two products with the same name, the same product ID and the same sort value in different catalogues had no defined
  order on the old page (it followed database storage). The migration puts the chemical product first.
- A pending request that is rolled back and migrated again can move by one place (it is re-expressed each way).
