# PROJECT_ARCHITECTURE.md — Agross website

> Source of truth is the code and data in this repository. If this document disagrees with them, the code wins; update this file.
> Last verified: 2026-11-02 (initial read-only analysis). This file intentionally contains no credentials.

## 1. Purpose
Corporate marketing and lead-generation site for **Agross** (an Agromaxx brand, Bhopal, Madhya Pradesh), an agro-input company.
- Product catalogue: 67 chemical and 40 non-chemical (bio/organic) products, with search.
- Company pages: About, Innovation, "Fasal Vaccine", Success Stories, FAQ, Privacy, Terms.
- Email enquiries: dealership, contract/custom farming, recruitment and general contact.
- No user accounts, roles, admin area or database.

## 2. Technology stack
| Layer | Details |
|---|---|
| Frontend | Static hand-written HTML (~20 pages); compiled Tailwind in `assets/dist/output.css`; jQuery, Swiper, Magnific Popup, MeanMenu, Odometer, WOW, Appear (`assets/js/`) |
| Enquiries | Vercel function at `/api/enquiry` delivers form submissions to `info@agromaxx.in` through Brevo |
| Data | Flat JSON files (`chemical.json`, `nonchemical.json`, `allproducts.json`) |
| Hosting | Vercel serves the static site and runs the enquiry function |
| Build / tests | `npm run build` prepares static assets and `npm test` checks the forms. The repo contains compiled Tailwind CSS. |
| Third parties | Google Fonts, Translate and Maps, Font Awesome 4.5, Bootstrap on some pages, and links to Agromaxx’s external business profiles |

## 3. Repository map
- Root `*.html` — pages: `index`, `about`, `innovation`, `fasal`, `success-stories`, `FAQs`, `privacy`, `terms`, `joinus`, `Partner-with-us`, `contact`, `Form-2/3/4`, `thankyou`, `404`, `preloader`.
- `chemicals.html`, `nonchemical.html` — catalogue listings (static cards, tab filters).
- `product.html` (chemical) and `nonchemical-details.html` (non-chemical) — detail pages driven by `?productId=` + JSON.
- `product_detail.html` — template-leftover; not linked from anywhere.
- `chemical.json` (67), `nonchemical.json` (40), `allproducts.json` (96; unreferenced by any page).
- `products/` — product packshots (`products/<Name>.png`) and a catalogue `.docx`.
- `assets/` — `js/` (`main.js` UI behaviour; `product-search.js` header product search), `css/` (vendor CSS), `dist/output.css`, `img/`, site images.
- `illustra/` — illustration images.
- `contact.php`, `form-2.php`, `form-3.php`, `form-4.php` — legacy PHP handlers, unused by the public pages.
- `ssl/`, `acme/`, `.well-known/`, `certificate.cer`, `agross.txt`, `csr.txt` — certificates/keys/CSRs (see Risks).
- Leftovers: `agro/` (empty), `index.html1` ("This is test."), `.vscode/` (Windows Apache path, Live Server port 5501).

## 4. Frontend architecture
- No router. Plain files linked by `href`. **Header/footer/nav are duplicated in every page** (~18 files); a nav change must be made in each.
- Catalogue: `chemicals.html` (~2,400 lines) / `nonchemical.html` hold static product cards linking to `product.html?productId=<id>` or `nonchemical-details.html?productId=<id>`. Category tabs (`.customer-service-tabs`, `data-tab`) are jQuery in `assets/js/main.js`. Handlebars is loaded in `chemicals.html` but unused.
- Detail pages: inline script reads `productId` from the URL, `fetch`es the JSON, finds the record by `productId`, fills the DOM. `technical` is set via `innerHTML` (and `benefits` on the non-chemical page); other fields via `textContent`. Errors: "Product Not Found" / "Error retrieving product details".
- Search: `assets/js/product-search.js` (loaded on every page with the header search) builds one list from `chemical.json` and `nonchemical.json` on first use and drives both the desktop box (`#search-input` / `#autocomplete`) and the mobile box (`#search-input1` / `#autocomplete1`). Rows are real links (`<a href>`) to `product.html?productId=<id>` or `nonchemical-details.html?productId=<id>`; the first record per ID is used, as on the detail pages. Names are matched with spaces and hyphens equivalent; extra spellings live in the `ALIASES` map at the top of the file; names shared by both catalogues get a Chemical / Non-chemical tag; missing thumbnails fall back to `assets/agross-logo.png`. New products added to the JSON appear in search automatically. Styles for the suggestion lists are the `.autocomplete*` rules in `assets/dist/output.css`; the desktop panel stays open via `li.searchml-12:focus-within > ul` (the header item otherwise opens only on hover).
- Styling: Tailwind utility classes with custom tokens (e.g. `text-optional-color`, `bg-primary-gradient-colorr`). `privacy.html` has its own styles; `terms.html` uses Bootstrap 4 and `thankyou.html` uses Bootstrap 5.
- No client state, no localStorage, no cookies set by site code.

## 5. Enquiries and privacy
`contact.html`, `Form-2.html`, `Form-3.html` and `Form-4.html` submit to `/api/enquiry`. The Vercel function validates the form, asks Brevo to send it to `info@agromaxx.in`, and confirms the submission when Brevo accepts the request. The visitor's email becomes the reply address.

`privacy.html` documents this flow and lists `info@agromaxx.in` for privacy requests and grievances. See `SMTP_SETUP.md` for the Vercel environment variables and legacy PHP configuration.

## 6. Data model (JSON product record)
`productId` (lookup key; may contain spaces), `name`, `image`, `technical` (may contain HTML), `type`, `packing`, `category`, optional `subcategory`, `tags`, `application`, `dose`, `benefits`, and optional `targetcrops`, `targetdiseases`, `targetinsects`, `targetweeds`, `targetpests`, `target`.

Known data issues (as of 2026-11-02):
- `tattoo` and `maxx zyme` exist in both chemical and non-chemical JSON.
- Duplicate IDs: `nonchemical.json` 40 entries / 39 IDs; `allproducts.json` 96 / 94.
- `allproducts.json` disagrees with the category files on 11 IDs (e.g. `rotomaxx` vs `Rotomax`).
- Missing images: `products/Mex Quin.png`, `Rotomaxx.png`, `Maxx Prom-.png`, `Potax Dm.png`, `Red Bull.png`.
- `type` values inconsistent (`nonchemical`, `non-chemical`, `BIOLOGICAL`, `ORGANIC`); category casing varies.
- Fixed 2026-11-05 (not yet deployed): Rotomax `productId` is now lowercase `rotomax` in `nonchemical.json`; Fasal Vriddhi Kit image-link typo in `nonchemical.html`; Fire search entries now point to `nonchemical-details.html`. All 392 listing/search links resolve locally.
- `veera` has two records in `nonchemical.json` (second one unreachable).
- Search (branch `feature/shared-product-search`, not yet deployed): the two hard-coded search lists were replaced by `assets/js/product-search.js`; every product in both JSON files is searchable.
- Catalogue names still differ in places from the spellings visitors know (e.g. `MAXX-CURE`, `POTAX-DM`, `CAMASA`); search shows the catalogue name and keeps old spellings as aliases.
- `products/Mex Quin.png` is missing; search shows the fallback logo for it.

## 7. Key workflows
1. Browse: listing page → card → `product.html?productId=x` → fetch JSON → render.
2. Search: header input → filter the two catalogues → select the product link.
3. Enquiry: complete the form → submit it to `/api/enquiry` → see the confirmation page after Brevo accepts it.

## 8. Authentication and permissions
None. Only control: HTTPS redirect in `.htaccess`.

## 9. External integrations
Google Fonts, Translate and Maps; CDN-hosted jQuery, Bootstrap, Popper, Font Awesome and Handlebars; WhatsApp and social links to Agromaxx’s business profiles. Brevo delivers form submissions to the business inbox.

## 10. Build, run, test
- `npm run build` copies the pages, product JSON files and assets into `public/`. The Tailwind source is absent. Existing classes are defined in `assets/dist/output.css`.
- Use a static server to preview pages and `vercel dev` to run the enquiry function locally. Run `npm test` to exercise the form flow with a mock email provider.
- Vercel deploys the site and the enquiry function from GitHub.

## 11. Conventions
- Tailwind utility classes and existing color tokens; jQuery IIFE style in `main.js`.
- Lowercase product IDs; images at `products/<Name>.png`.
- Mixed filename casing (`Form-2.html` vs `form-2.php`, `FAQs.html`) — matters on case-sensitive hosts.
- Follow existing duplicated-markup pattern unless a refactor is requested.

## 12. Critical dependencies and risks
1. **Private keys in the web root**: `ssl/`, `acme/`, `.well-known/pki-validation/*privatekey.key`. If deployed, publicly downloadable; treat as compromised and rotate.
2. **Legacy PHP handlers** read SMTP credentials from the hosting environment. They are not used by the enquiry pages.
3. **Legacy mailer weaknesses**: unescaped HTML body, no CAPTCHA/rate limit, `ErrorInfo` echoed to users, and potential SPF/DMARC issues from visitor-supplied sender addresses.
4. `form-2.php` reads `dealers` but omits it from the email body (data loss).
5. PHP `require` paths use backslashes (`PHPMailer\src\...`); fail on Linux. Production behaviour unverified.
6. No version control.
7. Header/footer duplicated across pages; product data duplicated in listing HTML, JSON and search index.
8. Backslash asset paths (`illustra\logo.png`, `assets\img\...`) break on Linux.

## 13. Known limitations and unresolved questions
- Whether key/cert folders are publicly served.
- Where the Tailwind source lives.
- Confirm which of the published telephone numbers should remain (`+917554064440`, `+919730057300`, `+9903236897`, `+9903294263`).
- Broken internal links: `Value.html` (appears commented out in nav), `pricing.html`, `premium.html`, `profile-authentication.html`, `blog-grid.html`, `blog-details.html`, `agross.html`.
- Markup: `index.html` lacks `<html>`; `thankyou.html` lacks viewport meta; 18 pages share `<title>Agross</title>`.
- Page copy of `about`, `innovation`, `fasal`, `success-stories`, `joinus`, `Partner-with-us` was reviewed at heading level only.

## Admin dashboard (branch `feature/admin-dashboard`, local only, not deployed)

- Design and decisions: `docs/admin-dashboard-proposal.md`. Local setup: `docs/local-development.md`.
- `api/enquiry.js` now saves each enquiry and a pending notification job in PostgreSQL before confirming, then sends through Brevo. `lib/` holds shared code (`forms.js` validation, `inbox.js` queries, `notify.js` Brevo and delivery events, `auth.js` sign-in and sessions, `security.js` rate limits, `db.js` migrations).
- Admin pages (`admin/views/*.html`) are served only by `api/admin-page.js` after a session check; the API is `api/admin.js` (one function, `/api/admin/<route>`); delivery events arrive at `api/brevo-webhook.js`.
- Tables are in `db/migrations/`. Owner-only sign-in with scrypt hashes, hashed session tokens, login throttling, CSRF token and origin checks.
- Not yet built: product editor, catalogue API, image storage, scheduled email retries, MFA.
