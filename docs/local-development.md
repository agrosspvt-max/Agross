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

## Product catalogue (Phase 2)

```bash
npm run db:migrate                 # adds the catalogue tables (002)
npm run catalogue:import           # imports the existing 106 products as DRAFTS and rewrites docs/catalogue-reconciliation.md
npm run catalogue:import -- --report-only    # only rewrite the report
```

Sign in, open **Products**. The public site keeps its original pages until you press
"Switch on the managed catalogue" (locally this shows only the products you published).
Switch it off again from the same card. The import never publishes and never overwrites a product that already exists.

## Recruiting

Run `npm run db:migrate` to add job openings, then sign in and open **Recruiting**.
Set a designation, an optional area, and a description. Choose **Open** to list the role on
`/joinus.html`. Closing a role removes it from the public list and stops new
applications for it. Earlier applications and their resumes remain in **Enquiries**.

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
