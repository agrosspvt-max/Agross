# PROJECT_ARCHITECTURE.md — Agross website

> Source of truth is the code and data in this repository. If this document disagrees with them, the code wins; update this file.
> Last verified: 2026-11-02 (initial read-only analysis). This file intentionally contains no credentials.

## 1. Purpose
Corporate marketing and lead-generation site for **Agross** (an Agromaxx brand, Bhopal, Madhya Pradesh), an agro-input company.
- Product catalogue: 67 chemical and 40 non-chemical (bio/organic) products, with search.
- Company pages: About, Innovation, "Fasal Vaccine", Success Stories, FAQ, Privacy, Terms.
- Lead forms: dealership, contract/custom farming, Join Us, general contact.
- No user accounts, roles, admin area or database.

## 2. Technology stack
| Layer | Details |
|---|---|
| Frontend | Static hand-written HTML (~20 pages); compiled Tailwind in `assets/dist/output.css`; jQuery, Swiper, Magnific Popup, MeanMenu, Odometer, WOW, Appear (`assets/js/`) |
| Backend | 4 standalone PHP scripts + bundled PHPMailer 6.8.0 (`PHPMailer/`), SMTP via Brevo (`smtp-relay.brevo.com:587`) |
| Data | Flat JSON files (`chemical.json`, `nonchemical.json`, `allproducts.json`) |
| Hosting | cPanel/Apache (`.htaccess`: HTTPS redirect, `ea-php71` handler) |
| Build / tests / CI | None. No `package.json`, no Tailwind source/config (only compiled CSS), no tests, no CI, no git history |
| Third parties | Google Fonts, Google Translate widget, Font Awesome 4.5 (maxcdn), Bootstrap 4/5 (a few pages), `sdk.levo.so` (home page), WhatsApp float button |

## 3. Repository map
- Root `*.html` — pages: `index`, `about`, `innovation`, `fasal`, `success-stories`, `FAQs`, `privacy`, `terms`, `joinus`, `Partner-with-us`, `contact`, `Form-2/3/4`, `thankyou`, `404`, `preloader`.
- `chemicals.html`, `nonchemical.html` — catalogue listings (static cards, tab filters).
- `product.html` (chemical) and `nonchemical-details.html` (non-chemical) — detail pages driven by `?productId=` + JSON.
- `product_detail.html` — template-leftover; not linked from anywhere.
- `chemical.json` (67), `nonchemical.json` (40), `allproducts.json` (96; unreferenced by any page).
- `products/` — product packshots (`products/<Name>.png`) and a catalogue `.docx`.
- `assets/` — `js/` (`main.js` UI behaviour; `product-search.js` header product search), `css/` (vendor CSS), `dist/output.css`, `img/`, site images.
- `illustra/` — illustration images.
- `contact.php`, `form-2.php`, `form-3.php`, `form-4.php` — mail handlers.
- `ssl/`, `acme/`, `.well-known/`, `certificate.cer`, `agross.txt`, `csr.txt` — certificates/keys/CSRs (see Risks).
- Leftovers: `agro/` (empty), `index.html1` ("This is test."), `.vscode/` (Windows Apache path, Live Server port 5501).

## 4. Frontend architecture
- No router. Plain files linked by `href`. **Header/footer/nav are duplicated in every page** (~18 files); a nav change must be made in each.
- Catalogue: `chemicals.html` (~2,400 lines) / `nonchemical.html` hold static product cards linking to `product.html?productId=<id>` or `nonchemical-details.html?productId=<id>`. Category tabs (`.customer-service-tabs`, `data-tab`) are jQuery in `assets/js/main.js`. Handlebars is loaded in `chemicals.html` but unused.
- Detail pages: inline script reads `productId` from the URL, `fetch`es the JSON, finds the record by `productId`, fills the DOM. `technical` is set via `innerHTML` (and `benefits` on the non-chemical page); other fields via `textContent`. Errors: "Product Not Found" / "Error retrieving product details".
- Search: `assets/js/product-search.js` (loaded on every page with the header search) builds one list from `chemical.json` and `nonchemical.json` on first use and drives both the desktop box (`#search-input` / `#autocomplete`) and the mobile box (`#search-input1` / `#autocomplete1`). Rows are real links (`<a href>`) to `product.html?productId=<id>` or `nonchemical-details.html?productId=<id>`; the first record per ID is used, as on the detail pages. Names are matched with spaces and hyphens equivalent; extra spellings live in the `ALIASES` map at the top of the file; names shared by both catalogues get a Chemical / Non-chemical tag; missing thumbnails fall back to `assets/agross-logo.png`. New products added to the JSON appear in search automatically. Styles for the suggestion lists are the `.autocomplete*` rules in `assets/dist/output.css`; the desktop panel stays open via `li.searchml-12:focus-within > ul` (the header item otherwise opens only on hover).
- Styling: Tailwind utility classes with custom tokens (e.g. `text-optional-color`, `bg-primary-gradient-colorr`). `privacy.html`/`terms.html` use Bootstrap 4; `thankyou.html` uses Bootstrap 5.
- No client state, no localStorage, no cookies set by site code.

## 5. Backend architecture (PHP)
Each script: on `POST`, read `$_POST` → build HTML body → send via PHPMailer/Brevo to `info@agross.in` → redirect to `https://agross.in/thankyou.html`; on exception, echo `ErrorInfo`.

| Script | Fields read | Subject |
|---|---|---|
| `contact.php` | name, email, website, phone, message | Contact Us Request |
| `form-2.php` | name, firm, mobile, state, district, teshil, email, dealers, remark | Dealership Request |
| `form-3.php` | name, email, mobile, authorised, produce, quantity, address | Contract/Custom farming Request |
| `form-4.php` | name, contact, email, profile, state, address | Join Us Request |

No auth, middleware, logging, storage, rate limiting or server-side validation. Submissions exist only as emails.
**The HTML forms post to `https://client.digitalcube.tech/agross/<script>.php`** (agency host), not to agross.in. The scripts in this repo may differ from what is deployed.

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
2. Search: header input → filter hard-coded array → click navigates to product URL.
3. Lead form: HTML5 `required` only → POST to agency-hosted PHP → email to `info@agross.in` → `thankyou.html`.

## 8. Authentication and permissions
None. Only control: HTTPS redirect in `.htaccess`.

## 9. External integrations
Brevo SMTP; Google Translate; Levo SDK; WhatsApp links (`+919730057300`); CDN-hosted jQuery/Bootstrap/Popper/Font Awesome/Handlebars; agency host `client.digitalcube.tech`; social links (Facebook, Twitter, LinkedIn, Instagram, YouTube, krishify.com); credit links to envytheme.com and digitalcube.tech. No analytics script found, though `privacy.html` mentions Google Analytics and Bayer links (likely copied boilerplate).

## 10. Build, run, test
- No build or tests. Tailwind source is absent, so new utility classes are not available unless added to `output.css` or the source is recovered.
- Local preview: any static server (e.g. VS Code Live Server on 5501, or `php -S localhost:8000` for PHP). JSON `fetch` needs HTTP, not `file://`.
- Deployment is not defined in the repo.

## 11. Conventions
- Tailwind utility classes and existing color tokens; jQuery IIFE style in `main.js`.
- Lowercase product IDs; images at `products/<Name>.png`.
- Mixed filename casing (`Form-2.html` vs `form-2.php`, `FAQs.html`) — matters on case-sensitive hosts.
- Follow existing duplicated-markup pattern unless a refactor is requested.

## 12. Critical dependencies and risks
1. **Private keys in the web root**: `ssl/`, `acme/`, `.well-known/pki-validation/*privatekey.key`. If deployed, publicly downloadable; treat as compromised and rotate.
2. **SMTP credentials hard-coded** in all four PHP files; rotate and externalize.
3. **Mailer weaknesses**: unsanitised `setFrom($email)` and HTML body (header/HTML injection), no CAPTCHA/rate limit, `ErrorInfo` echoed to users, arbitrary sender fails SPF/DMARC.
4. `form-2.php` reads `dealers` but omits it from the email body (data loss).
5. PHP `require` paths use backslashes (`PHPMailer\src\...`); fail on Linux. Production behaviour unverified.
6. No version control.
7. Header/footer duplicated across pages; product data duplicated in listing HTML, JSON and search index.
8. Backslash asset paths (`illustra\logo.png`, `assets\img\...`) break on Linux.

## 13. Known limitations and unresolved questions
- Which host actually runs the PHP, and how the site is deployed.
- Whether key/cert folders are publicly served.
- Where the Tailwind source lives.
- What the Levo SDK does.
- Contact inconsistency: footer shows `info@agromaxx.in`; forms mail `info@agross.in`; multiple phone numbers (`+917554064440`, `+919730057300`, `+9903236897`, `+9903294263`).
- Broken internal links: `Value.html` (appears commented out in nav), `pricing.html`, `premium.html`, `profile-authentication.html`, `blog-grid.html`, `blog-details.html`, `agross.html`; `assets/css/bootstrap-custom.css` missing (affects `privacy.html`).
- Markup: `index.html` lacks `<html>`; `thankyou.html` lacks viewport meta; 18 pages share `<title>Agross</title>`.
- Page copy of `about`, `innovation`, `fasal`, `success-stories`, `joinus`, `Partner-with-us` was reviewed at heading level only.
