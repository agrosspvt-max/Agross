# Agross admin dashboard: design proposal (revised scope)

Status: **Phase 1 (sign-in and enquiry inbox, commit 88142e9) and Phase 2 (product editor, managed catalogue and import) are built and tested locally with sample data and a mock Brevo. Nothing is deployed, published or connected to any live account. The imported catalogue is 106 drafts awaiting the owner's decisions (`docs/catalogue-reconciliation.md`).** Decision recorded: product images will be stored in PostgreSQL (option A, section 9).
Revised 2026-11-11 from the repository on `main` (`17c7169`). Vendor costs and limits are not stated as facts where I have not verified them on the vendor's own page; they are marked "to confirm".

## 0. Scope

**In the first release (two priorities):**
1. **Enquiry inbox**: save every valid enquiry from the four existing forms, send the Brevo notification, show everything in a private dashboard.
2. **Product editor**: add, edit, image upload or replace, draft, preview, publish, archive, restore; the published catalogue drives the grids, filters, detail pages and site search.

**Supporting both:** simple username and password sign-in for one owner, and an Overview with three submission tiles.

**Out of scope (removed):** GA4 or any analytics provider, visitor counts, page views, conversion tracking, popular products, MFA (planned for later), multi-user staff management, enquiry notes, assignment, CSV export, automatic deletion.

**Ground rules:** work locally with sample data and a mocked Brevo. I will ask before: connecting a live account, publishing a hosted preview, using real data, sending a real test email, changing DNS, deploying to production, or enabling anything that could incur charges.

## 1. What the repository contains today (verified)

| Area | Finding |
|---|---|
| Hosting | Vercel (`vercel.json`: no framework, `npm run build`, output `public/`). `scripts/build.js` copies `*.html`, the three JSON files, `assets/`, `illustra/`, `products/`. Node 22.x. No runtime dependencies yet. |
| Enquiries | `api/enquiry.js` validates the four forms (`contact`, `dealership`, `farming`, `recruitment`), honeypot field `fax`, origin checks, size limits, then sends through Brevo to `info@agromaxx.in` with the visitor as Reply-To. **It stores nothing**, so a Brevo failure loses the enquiry. `assets/js/forms.js` posts the form and blocks double clicks. 18 tests pass (`npm test`). |
| Existing work | `codex/own-form-email-draft` is an older draft of the same handler; `main` already contains the later version. Legacy PHP handlers remain. `ssl/`, `acme/`, `.well-known/` and key files are git-ignored and were never committed. |
| Catalogue data | `chemical.json` (67 records), `nonchemical.json` (40 records, 39 unique IDs; `veera` appears twice). `allproducts.json` is copied by the build but no page reads it. |
| Who reads the JSON | `product.html`, `nonchemical-details.html`, `assets/js/product-search.js`. Nothing else in the repo. Shared links and QR codes outside the repo are unknown. |
| Listing pages | `chemicals.html` (126 cards across All + 4 tabs) and `nonchemical.html` (74 cards across All + 5 tabs) are hard-coded HTML, not generated from the JSON. |

### First-pass catalogue reconciliation (the import will produce the full report)

- Chemical grid shows 63 products; JSON has 67. Not in the grid: `maxx zyme`, `mex quin` (also has no image file), `mint`, `zilmil`.
- Non-chemical grid shows 36; JSON has 39 unique IDs. Not in the grid: `fasal vriddhi kit`, `maxx grow`, `ninja`, `pretej`, `tattoo`.
- `mint` and `zilmil` appear in the non-chemical grid but exist only in `chemical.json`. `tattoo` and `maxx zyme` exist in both JSON files.
- Chemical grid tabs map cleanly to JSON categories. The non-chemical JSON has 11 category spellings (`Organic`, `Biological`, `BIOLOGICAL`, `Manure`, `Bio-Fertilizer`, `PGPR` …) that the page folds into 5 tabs (Biofertilizer, Biofungicide, Biolarvicide, Bioinsecticide, PGPR). A separate **listing tab** field is needed.
- 107 image files in `products/` (57 MB). Missing: `Mex Quin.png`.

## 2. Architecture

```
Public pages (existing look, URLs)         Admin (owner only)
   static HTML + small JS                     static shell + vanilla JS modules
        |                                              |
        v                                              v
Vercel Functions ---------------------------------------------------------
  /api/enquiry          public: validate, save + queue job, send via Brevo
  /api/catalogue        public: published products only, CDN-cached
  /api/listing          renders chemicals.html / nonchemical.html cards
  /api/brevo-webhook    delivery events (shared secret)
  /api/admin/*          every request: session + permission check
        |
        v
PostgreSQL  (local Postgres in Docker for development; Neon for production)
        |
Brevo (email)         Image store (see section 9)
```

- **No framework.** Admin pages are static HTML plus ES modules, matching the repo. New runtime dependency: `pg` (Postgres driver). Password hashing uses Node's built-in `crypto.scrypt`, so no native add-ons.
- **All persistent data is in PostgreSQL**: admin accounts and sessions, enquiries, notification jobs, products, product revisions, audit log.
- **Server-side enforcement.** `/admin/*` pages are served through a gating function that checks the session before returning HTML (login page otherwise). Every `/api/admin/*` call checks session and permission again. Knowing a URL gives nothing.
- **Indexing.** `X-Robots-Tag: noindex, nofollow` on `/admin*` and `/api/admin*`, a robots meta tag in the shell, no public navigation links.
- **Time.** Stored as UTC `timestamptz`; every filter, tile and displayed time uses `Asia/Kolkata`.
- **Environments.** Local (Docker Postgres, seeded sample data, mock Brevo) → hosted preview (own Neon branch/project, sample data only, **needs your approval**) → production (dedicated Agross Neon project, **needs your approval**).

## 3. Admin sign-in

- Username and password; one **owner** account to start; no registration endpoint exists.
- **Hashing:** scrypt (memory-hard) with a per-user random salt; parameters stored with the hash so they can be raised later. Minimum 12 characters. Constant-time comparison; identical error for unknown user and wrong password.
- **Rate limiting:** failed attempts counted per username and per hashed IP (salted, raw IPs not stored) in Postgres. After 5 failures in 15 minutes, further attempts are delayed or refused for a cool-down. Counters reset on success.
- **Sessions:** a random 256-bit token in a `__Host-` httpOnly, Secure, SameSite=Strict cookie. Only the SHA-256 hash is stored. Idle timeout 2 hours, absolute limit 12 hours, rotated at login, revoked at logout and on password change. Mutating requests are POST/PUT/DELETE only, check `Origin`, and require a per-session CSRF token.
- **Owner password reset** (no public reset endpoint to attack): a command-line script (`npm run admin:reset-password`) run by someone with access to the environment's database credentials. It sets a temporary password, forces a change at next login, and revokes every session. An emailed one-time reset link can be added later if you want it; testing it would need a real email, so it would be gated on your approval.
- **Creating the owner:** a one-off script prompts for the password (never stored in the repo or environment files).
- **Permissions:** the data model keeps a `permissions` list (`enquiries`, `recruitment`, `products_edit`, `products_publish`, `accounts`). The owner holds all of them. Until you confirm who may see recruitment submissions, only the owner exists and nothing is shared. The check for `recruitment` is already enforced on list, detail and filter queries so adding staff later does not require rework.
- **MFA later:** the session code reserves a step-up field so TOTP can be added without changing the tables the rest of the system uses.

## 4. Data model (PostgreSQL)

| Table | Purpose and key columns |
|---|---|
| `admin_users` | `id`, `username` (unique, case-insensitive), `password_hash`, `display_name`, `email` (for a future emailed reset), `permissions text[]`, `active`, `must_change_password`, `created_at`, `last_login_at`. |
| `admin_sessions` | `id`, `user_id`, `token_hash`, `csrf_token`, `created_at`, `last_seen_at`, `expires_at`, `revoked_at`, `ip_hash`, short `user_agent`. |
| `rate_limits` | Salted-hash key (`login:user:…`, `login:ip:…`, `enquiry:ip:…`), window start, count. Also limits the public enquiry endpoint. |
| `enquiries` | `id` (uuid), `submission_key` (unique, created by the page), `form_type` (contact/dealership/farming/recruitment), `display_name`, `email`, `phone`, `fields jsonb` (all validated values), `source_page`, `status` (new/in_progress/resolved), `status_changed_by/at`, `created_at`; indexes on date, form, status and search text. |
| `notification_jobs` | One per enquiry: `state` (pending/sending/accepted/delivered/failed/unconfirmed), `attempts`, `next_attempt_at`, `locked_until`, `provider_message_id`, `last_error_code`, `accepted_at`, `delivered_at`. |
| `listing_tabs` | `listing_page` (chemicals/nonchemical), `key`, `label`, `display_order`. |
| `products` | `id`, `catalogue` (chemical/nonchemical: decides the detail page and JSON shape), `product_id` (permanent public ID, immutable, unique with `catalogue`), `listing_page` and `listing_tab` (where the card appears; usually equals the catalogue but not always, e.g. `mint`, `zilmil`), `status` (draft/published/archived), `published jsonb`, `draft jsonb`, `display_order`, `published_at/by`, `updated_at/by`. |
| `product_revisions` | Append-only: product, revision number, full content snapshot, action (draft saved, published, archived, restored), actor, time. Restore uses these. |
| `product_images` | Only if images are stored in the database (section 9): `id`, content type, bytes, sha256, size, created_by. |
| `audit_log` | `at`, `actor`, `action`, `entity_type`, `entity_id`, small `metadata` (IDs and statuses, **never enquiry text**). Covers sign-in failures/successes, password reset, enquiry status changes, notification retries, product publish/archive/restore/delete. |

Product content fields (mapped from current JSON): `name`, `catalogue`, `category`, `subcategory`, `listing_tab`, `description`, `technical` (sanitised rich text that keeps `<br>`), `target_crops`, `target_pests`, `target_diseases`, `target_insects`, `target_weeds`, `target`, `benefits`, `application`, `dose`, `packing` (list), `tags/aliases` (list; used by search, e.g. "Rotomaxx"), `image`, `image_alt`, `type`, `display_order`. Optional fields can stay blank.

Atomic submit: one SQL statement/transaction inserts the enquiry and its pending `notification_jobs` row, and returns the existing record if `submission_key` already exists. A double click or browser retry therefore creates one enquiry and one job.

## 5. Enquiry inbox and Brevo

1. The form page generates a `submission_key` and posts to `/api/enquiry`. Fields, validation, honeypot and origin checks stay as today, with rate limiting added.
2. The enquiry and pending job are saved together. **Only then** does the visitor see the confirmation page. If saving fails, the visitor sees an error and keeps their input (current `forms.js` behaviour).
3. The function then tries Brevo (existing account, `FORM_FROM_EMAIL`, to `info@agromaxx.in`, visitor as Reply-To). A failure leaves the enquiry saved, visible, and the job **Failed** with a **Retry** button for staff.
4. Retries are safe: a job is locked while sending; a timeout whose outcome is unknown becomes **Unconfirmed** and the retry button warns that a duplicate email is possible. The Brevo message is tagged with the enquiry ID so a lookup can confirm whether it was sent (*Brevo lookup endpoint to be verified during build*).
5. States shown: **Pending**, **Accepted by Brevo** (message ID stored), **Failed**, **Unconfirmed**, and **Delivered** only when Brevo's webhook reports delivery. The webhook needs a public URL and a secret registered in your Brevo account, so it is built and tested with a mock first; registering it is a live-account step that needs your approval.
6. **Scheduled retries** need a scheduler. As built, a failed email is retried by staff with the **Retry** button; there is no automatic retry yet. I will verify your Vercel plan before recommending a scheduler (Vercel cron or another).

**Inbox screen:** paginated table (submitted time in IST, form type, name or company, contact details, follow-up status, email status). Filters: date range, form type, follow-up status, email status. Search by name, company, email or phone. Detail view shows **every submitted field** and the notification state with history and Retry. Status buttons **New**, **In progress**, **Resolved** record who and when. Recruitment records follow the permission rule in section 3.

## 6. Overview

Date filter: Today, Last 7 Days, Last 30 Days, Custom (all IST). Three tiles, all counted from saved enquiries:

| Tile | Count | Click opens |
|---|---|---|
| **Total submissions** | Saved enquiries in the range | Inbox with that date range |
| **New enquiries** | Enquiries in the range with status New | Inbox with that range and status New |
| **Submissions by form type** | Counts for Contact, Dealership, Contract/Custom Farming, Recruitment | Inbox with that range and the chosen form |

Loading, empty and error states are shown; an error is never shown as zero. The selected range is carried in the URL.

## 7. Product editor

- **List:** searchable, paginated; filter by catalogue, category, listing tab and status (draft, published, archived).
- **Edit:** structured fields above; validation of required fields, catalogue/category/tab combinations and ID uniqueness (before publish); technical details keep their formatting through sanitised rich text.
- **Image upload:** replace, preview, alt text; server checks file type (by content, not name), size limit and dimensions.
- **Draft and published are separate.** Editing writes `draft`; the public site keeps serving `published` until **Publish**. A product can exist as a draft that has never been published.
- **Preview** shows both the product card and the detail page using the same templates the public site uses, inside the admin only.
- **Archive** removes the product from the grid and from search; **Restore** brings back the last published version. A direct link to an archived product shows a "product unavailable" message with a link back to the right catalogue. Permanent delete is a separate, confirmed action, not part of normal use.
- Revision history with who and when; restore a previous revision.

## 8. Public catalogue and migration

**One published catalogue** feeds everything:
- `GET /api/catalogue?catalogue=chemical|nonchemical` returns published products only, **in the same JSON shape as today**, so `product.html`, `nonchemical-details.html` and `product-search.js` change only their URL. `&productId=` returns one product, or an archived/unavailable status.
- **Grids keep their cards in the HTML served to visitors.** `chemicals.html` and `nonchemical.html` are answered by `/api/listing`, which takes today's page as a template and fills the existing card markup, tabs and filters from the published catalogue, so the public URLs and appearance do not change and search engines still see the cards in the HTML. Responses are cached at the edge (`s-maxage=60, stale-while-revalidate=300`), so **published changes appear in about 1 to 6 minutes (to be measured)**. No deploy hook or rebuild is needed.
- **Search** reads the same endpoint, so a rename cannot show different names in the grid, detail page and search.
- **Fallback and rollback:** if the database is unreachable, the listing function serves the last static pages and pages fall back to the static JSON files, which stay in the repo. Rolling back means reverting the rewrites; the static files still work.
- **URLs.** `product_id` is the permanent identifier and cannot be edited, so display-name changes never change a URL. `nonchemical-details.html?productId=rotomax` and every current link keep working.

**Migration:**
1. An import script reads `chemical.json`, `nonchemical.json` and the two grid pages and creates **drafts** in the local database. It is safe to rerun (upsert on `catalogue + product_id`).
2. A **reconciliation report** lists: source and imported counts; **both `veera` records** side by side; the **category-to-tab mapping** (each JSON category spelling and the tab it appeared under, for your confirmation); **products whose listings and JSON disagree** (in grid but not JSON, in JSON but not grid, listed under a different page than their catalogue); missing images; products present in both catalogues; any missing required fields.
3. **Nothing is published until you confirm those decisions.** I will not choose a `veera` record, tab mapping or placement myself.
4. In a local environment I compare public output against current production pages (card counts per tab, every link, search results) before any hosted step.

## 9. Product images

Existing images stay where they are in `products/` and keep their URLs. New or replaced images need somewhere to be stored, because functions cannot write into the deployed site. Options:

| Option | Notes |
|---|---|
| **A. In the Postgres database** (my default for the first release) | No new service or vendor. Images served through a cached `/api/image/<id>` URL. Adds to Neon storage (a few hundred KB per image; a modest number of products is small). Size limit enforced. |
| B. Vercel Blob | Simple, purpose-built. A new usage-based service; cost and allowance **to confirm** before enabling. |
| C. Another object store (S3-style) | A new vendor, account and bill. |

The product record stores an image reference, so moving from A to B later does not change anything else. **Decision: option A (database).**

## 10. Costs and usage flags (confirm before setup)

| Item | Note |
|---|---|
| **Neon** | You already have a paid account. Plan: a **dedicated Agross project** in your existing organization. Expected load is small (enquiry and product text). Two things to check before creating it: whether another project is covered by your current plan, and the project's **auto-suspend** setting (idle compute shuts down; the first request after a pause is slower; keeping it always on increases compute use). If images go in the database (option A), storage grows with each upload. I will not create the project without your approval. |
| **Vercel** | Kept for the live site during development. Documentation I found says the free Hobby plan is for non-commercial use and limits scheduled jobs to once a day. **I will verify the project's current plan with you before recommending any hosting change.** The new functions add invocations (the listing and catalogue responses are cached to limit this). |
| **Brevo** | Existing account; no new cost expected for notification volume (to confirm against your plan's limits). Webhook registration is a live-account change. |
| **Analytics** | Removed from scope. No new cost. |
| **Images** | Option A: none beyond Neon storage. B or C: a new service cost. |

## 11. Environment variable names (no values)

`DATABASE_URL`, `BREVO_API_KEY`, `FORM_FROM_EMAIL`, `BREVO_WEBHOOK_SECRET`, `CRON_SECRET` (only if scheduled retries are used), `IP_HASH_SALT`, `SITE_URL`, and, only if option B is chosen, `BLOB_READ_WRITE_TOKEN`. The owner password is entered once at creation by script and is never stored in an environment file.

## 12. Build order and demonstrations

**Local setup:** Docker Postgres, migration files, seeded sample enquiries and products, a mock Brevo server. Existing tests keep passing.

**Phase 1: sign-in and inbox.** Schema; owner creation and password-reset scripts; login with hashing, rate limits and sessions; gated admin pages; idempotent `/api/enquiry` with atomic save; notification jobs, mock Brevo, retry; inbox with filters, search, detail, status; Overview tiles.
Tests: each of the four forms saves the right record; a double click or retry creates one record and one job; a simulated Brevo failure leaves the enquiry visible with a retryable state; **Delivered** appears only after a delivery event; unauthenticated and expired-session requests are refused on every admin page and API; login rate limiting; tile counts equal the filtered inbox counts; IST date boundaries.

**Phase 2: product editor and migration.** Schema; import as drafts; reconciliation report; editor with draft, preview, publish, archive, restore, revisions and image upload; catalogue API; listing function; page and search switch.
Tests: add a product with an image, publish it, edit it, archive it, restore it, and verify each step in the correct grid, category filter, detail page and search; a draft edit leaves the published version visible; drafts and archived items never appear in public responses; Rotomax and other existing URLs resolve; fallback when the database is down; desktop and mobile.

**Before launch I will demonstrate:** all four forms saving; email failure leaving the enquiry visible; a product added, published, edited, archived and restored across the public catalogue.

**Not applied without your confirmation:** automatic deletion (disabled until you confirm the retention policy), any live account connection, hosted preview, real data, real test email, DNS change, production deployment, or paid service.

## 13. Decisions I need from you

1. ~~Image storage~~: decided, option A (database).
2. **Vercel plan** (section 10): which plan the project is on today.
3. **Neon:** whether a new project is covered by your plan and your preferred auto-suspend setting (section 10).
4. **Migration decisions** (after the report, not before): which `veera` record is correct, the category-to-tab mapping, and where each disagreeing product should be listed.
5. **Production owner** and **who may see recruitment submissions** (before more accounts are added).
6. **Retention policy** (before any automatic deletion exists).
7. Whether you want an emailed owner password reset link later, in addition to the command-line reset.

## 14. Phase 2 as built (local)

- **Managed catalogue is OFF by default.** A switch on the Products page (needs `products_publish`) turns the public site over to the managed catalogue and back instantly. While it is off, visitors get the original pages and JSON files exactly as today; this is also the rollback.
- `/chemicals.html` and `/nonchemical.html` are answered by `api/listing.js`, which fills the existing page (cards, tab buttons, grids) from published products, so the cards stay in the HTML. If the catalogue is off, has nothing published for that page, or the database is down, the original page is served. The two pages carry invisible `catalogue:start` / `catalogue:end` markers; they are not copied into the production build (so the function answers the request) but are read by the function as its template.
- `/api/catalogue` serves detail pages and search; `/api/image` serves uploaded images of published products only; staff see draft images through the admin preview. New data: tables in `db/migrations/002_catalogue.sql`.
- Images: existing ones stay in `products/`; uploads (PNG/JPEG/WebP, up to 2 MB, checked by content) are stored in PostgreSQL.
- Draft, preview (card and the real detail page via `?preview=`), publish, archive, restore, discard draft, history (load an older version into the draft), permanent deletion (archived or never-published only, ID typed back), optimistic locking against overlapping edits.
- **Refresh window:** browsers always revalidate; the edge may keep a copy for 30 s (plus up to 60 s while it refreshes), set with `Vercel-CDN-Cache-Control`. This header and Vercel's treatment of it must be confirmed at the hosting review.
- **Known behaviour to decide:** the grid shows one display order; the "All" grid will now include `ninja` and `fasal vriddhi kit`, which are in category tabs today but not under "All".

## 15. Editor layout and product photo sizing (local)

- **Editor:** on desktop the form is on the left and a **Product page preview** is on the right (the real public detail page in an embedded, staff-only view of the saved draft, drawn at desktop width and scaled to fit; plus the grid-card preview). The preview loads with the editor and refreshes after each successful **Save draft**, including a replaced image; a failed save keeps the form and shows the error. On narrow screens the preview stacks under the form. Status, History and Delete permanently are in a single collapsed **Product management** section below the editor. Screenshots: `docs/screenshots/`.
- **Photos:** `assets/js/product-image.js` finds the visible pack inside each picture (transparent or plain background removed), scales it to a fixed stage (80% of the stage height/width, picture never stretched or cropped) and centres it. Both detail pages share one stage and the same CSS; the preview uses the same pages. Checked on every product image (102): visible pack heights are 308 to 368 px on a 460 px stage; no image needed a special case.
