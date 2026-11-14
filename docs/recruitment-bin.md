# Recruitment Bin

Rejecting a recruitment application moves it to the Recruitment Bin straight away. It stays there for 30 days so an
accidental rejection can be undone, then a scheduled job deletes it permanently.

## How it behaves

- **Rejecting** (from the Enquiries list or the application page, general applications included) saves the status, the
  note, the "previous status" and the deadline (rejection time + 30 days) in one step. The application leaves the
  Enquiries lists, search and the "new enquiries" count at once. Nothing is emailed to the applicant.
- **The Bin** is the trash-bin icon beside the user's name, before Sign out. Choosing "Rejected" in the Enquiries
  status filter opens it. Each row shows the applicant, role (or "General application"), rejection date and the
  deletion date in IST. Staff can open an application, read its notes and view or download the PDF while it is in the Bin.
- **Restore** returns the application to the status it had before (In progress if that is not known) and clears the
  deadline. Notes and the PDF are untouched. A later rejection starts a fresh 30 days. Repeating the same rejection
  keeps its original deadline.
- **Permissions:** the Bin, the application, its PDF and Restore need the `enquiries` and `recruitment` permissions,
  the same as reading applications today.
- **Totals:** the overview's "Total submissions" still counts rejected and deleted applications as received; the new
  enquiries count and the active inbox leave them out. After deletion only a count per day and form type is kept
  (`enquiry_purge_tally`), never applicant data.

## When the 30 days end

- The application is unavailable at once: viewing, the PDF and Restore all check the stored deadline, not the cleanup.
- The next cleanup run deletes the application, its details and notes, its PDF and its email-notification record and
  history. It is safe to repeat, skips anything being restored, and cannot delete an application restored in time.
- The cleanup and the audit history log counts only, never applicant details.

## Scheduler

The cleanup is `api/recruitment-bin-cleanup.js`, run by a Vercel cron job (`vercel.json`, once a day at 21:30 UTC,
03:00 IST). It runs whether or not anyone opens the dashboard.

Your plan is Hobby, which allows cron jobs **once a day** and starts them **anywhere within the scheduled hour**;
delivery is best effort and Vercel does not retry a failed run. So a deadline is enforced immediately by hiding the
application, and the physical deletion happens in the next daily run, up to about a day and an hour later (longer if a
run is missed, because the next run catches up). A Pro plan allows exact-minute and more frequent runs.

**One setting is needed:** add `CRON_SECRET` to the Vercel project (Production), a random string of at least 16 letters
and numbers. Vercel sends it as `Authorization: Bearer <secret>` and the endpoint refuses every call without it, including
when `CRON_SECRET` is not set. Redeploy after adding it (a deployment keeps the value it was built with).

If a run is ever missed and you want to catch up by hand: `DATABASE_URL=<neon url> npm run bin:purge`.

## What the cleanup covers

It deletes what the website stores: the Neon database rows listed above. Not covered, and following their own
retention:

- **Copies already emailed to the recruitment mailbox** (the notification email contains the applicant's details and is
  sent when the application is submitted).
- **Neon's own history and backups.** Neon keeps changes for its restore window, which depends on your Neon plan; deleted
  rows remain recoverable inside that window. Check the window under the project's settings if it matters.

## Production setup

Do these in order; each needs your go-ahead.

1. In Vercel: add `CRON_SECRET` (Production).
2. Apply the migration (command below). It gives every application that is already **Rejected** a fresh 30 days from
   that moment, keeping its original rejection date. Their earlier status was not recorded, so Restore returns them to
   In progress.
3. Deploy (merge and push `main`). Do not reject anyone between steps 2 and 3: the previous code cannot save a rejection
   once the migration is in, and it fails with an error rather than leaving a half-saved record.
4. Check the job: Vercel dashboard > Schedules > Cron Jobs should list `/api/recruitment-bin-cleanup` with the schedule.
   After the first scheduled run (or by running it from that tab, if the button is there), open its logs: the line
   "Recruitment Bin cleanup" shows the counts and the response is 200. A 401 means the secret did not match; redeploy.
5. Try it end to end once: reject a test application, restore it, reject it again, and confirm it appears in the Bin.

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
  if [[ "${pending[*]}" != '010_recruitment_bin.sql' ]]; then
    echo 'Expected only 010_recruitment_bin.sql to be pending. Nothing was changed.'
    exit 1
  fi

  rejected=$(q "SELECT count(*) FROM enquiries WHERE status = 'rejected'") || exit 1
  echo "Applications already rejected: $rejected. Each gets a fresh 30 days from now."

  DATABASE_URL="$agross_neon_url" node scripts/migrate.js || exit 1

  in_bin=$(q "SELECT count(*) FROM enquiries WHERE bin_expires_at IS NOT NULL")
  echo "In the Recruitment Bin now: $in_bin"
  echo "First deletions due after: $(q "SELECT coalesce(to_char(min(bin_expires_at) AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY HH24:MI') || ' IST', 'nothing in the Bin')  FROM enquiries")"
  if [[ "$in_bin" == "$rejected" ]]; then
    echo 'Check passed: every rejected application is in the Bin with a deadline, and nothing else changed.'
    echo 'Next: deploy, then check the scheduled job (docs/recruitment-bin.md).'
  else
    echo 'Check FAILED. Send this output to Claude before deploying.'
  fi
)
```

## Rolling back

`db/rollback/010_recruitment_bin_down.sql` removes the Bin columns and the count table and deletes the migration
record, in one transaction. Applications in the Bin return to the old behaviour: they show in the Enquiries list as
Rejected and nothing deletes them. Run it, then deploy the previous version:

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f db/rollback/010_recruitment_bin_down.sql
```
