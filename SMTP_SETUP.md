# SMTP configuration

The four enquiry handlers (`contact.php`, `form-2.php`, `form-3.php`, and
`form-4.php`) read credentials from the PHP process environment:

| Variable | Value to configure on the mail-handler server |
| --- | --- |
| `SMTP_USERNAME` | Your Brevo SMTP login |
| `SMTP_PASSWORD` | A Brevo SMTP key |

The existing SMTP host (`smtp-relay.brevo.com`), port (`587`), TLS setting,
recipient, subjects, and redirects are unchanged. Email delivery requires both
variables to be available to PHP. This project does not automatically load a
`.env` file; configure the environment through the hosting provider/PHP service.
Do not put actual credentials in tracked files or a publicly served config file.

The HTML forms currently submit to `client.digitalcube.tech/agross`, so configure
the server that actually hosts those handlers. Updating this repository alone
does not update the deployed mail handlers.

Replace the SMTP key that was embedded in the original source with a new key
from Brevo and retire the old key after updating the active handler server.
Live email delivery must be checked after the server configuration is applied.

The handlers also retain their existing Windows-style PHPMailer include paths.
Those paths do not resolve on this macOS workspace; mail delivery on a different
hosting environment requires separate verification.
