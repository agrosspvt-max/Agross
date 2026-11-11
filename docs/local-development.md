# Local development: admin dashboard and enquiries

Everything here runs on this computer with sample data. Real email is switched
off: the dev server always uses a mock Brevo.

## One-time setup

```bash
npm install
npm run db:start       # private PostgreSQL on 127.0.0.1:5433 (data kept in .local/)
npm run db:migrate     # create the tables
npm run db:seed        # 48 fake enquiries + a local-only "demo" sign-in (password printed once)
```

`.env.local` (not committed) holds the local `DATABASE_URL`; `.env.example` lists the names.

## Run

```bash
npm run dev            # http://localhost:3000   (admin: http://localhost:3000/admin)
```

Mock Brevo (port 4010) lets you test email problems:
`http://127.0.0.1:4010/__mode?mode=ok` or `fail`, `timeout`, `unreadable`.
To see the Delivered state, post a delivery event to the local webhook:

```bash
curl -X POST http://localhost:3000/api/brevo-webhook \
  -H 'Authorization: Bearer local-dev-webhook-secret' -H 'Content-Type: application/json' \
  -d '{"event":"delivered","message-id":"<mock-1@agross.local>"}'
```

## Owner account and password reset

```bash
npm run admin:create-owner                       # prompts; password is never stored in a file
npm run admin:reset-password -- <username>       # prints a temporary password once
```

There is no public reset page. The reset ends all sessions and forces a new password at next sign-in.

## Tests

```bash
npm test               # database tests use the agross_test database and skip if it is not running
npm run db:stop        # stop the local database
```
