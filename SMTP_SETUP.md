# Website enquiries

The contact, dealership, contract farming and recruitment forms post to
`/api/enquiry`. The function validates the form, **saves the enquiry and a
pending email job in PostgreSQL**, and only then confirms to the visitor. It
then sends the notification through Brevo to `info@agromaxx.in`, using the
visitor's email as Reply-To. If Brevo fails, the enquiry stays saved and
visible in the admin dashboard with a Retry button.

Required environment variables (set them in the Vercel project; never commit values):

| Name | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. Without it, the forms return an error and nothing is confirmed. |
| `BREVO_API_KEY` | Brevo API key (sensitive). |
| `FORM_FROM_EMAIL` | Verified Brevo sender, `info@agromaxx.in`. |
| `BREVO_WEBHOOK_SECRET` | Shared secret Brevo sends with delivery events to `/api/brevo-webhook`. Delivered is shown only after such an event. |
| `IP_HASH_SALT` | Long random string used to hash IP addresses for rate limiting. |

Apply database changes with `npm run db:migrate` (uses `DATABASE_URL`).
Do not deploy this version before `DATABASE_URL` and the migration are in place.

Local development uses a private local PostgreSQL and a mock Brevo that never
sends email. See `docs/local-development.md`. Run `npm test` for the tests.

## Legacy PHP handlers

The PHP handlers remain in the repository for legacy use. To run them
separately on a PHP host, configure `SMTP_USERNAME` and `SMTP_PASSWORD` in the
PHP process environment. They use Brevo SMTP with TLS on port 587. Keep real
credentials in the hosting environment. The existing Windows-style PHPMailer
include paths need to be checked before running these handlers on other hosts.
