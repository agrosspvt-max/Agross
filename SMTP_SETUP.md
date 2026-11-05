# Website enquiries

The contact, dealership, contract farming and recruitment forms post to
`/api/enquiry`. The Vercel function sends the submission through Brevo to
`info@agromaxx.in` and uses the visitor's email as the reply address.

Set `BREVO_API_KEY` as a sensitive variable in the Vercel project, and set
`FORM_FROM_EMAIL` to the verified Brevo sender `info@agromaxx.in`. Select the
environment that will run the forms. A new deployment picks up the variables.

Run `npm test` to check submission behavior with a mock email provider. After
deployment, submit a test enquiry and confirm that it reaches the inbox.

## Legacy PHP handlers

The PHP handlers remain in the repository for legacy use. To run them
separately on a PHP host, configure `SMTP_USERNAME` and `SMTP_PASSWORD` in the
PHP process environment. They use Brevo SMTP with TLS on port 587. Keep real
credentials in the hosting environment. The existing Windows-style PHPMailer
include paths need to be checked before running these handlers on other hosts.
