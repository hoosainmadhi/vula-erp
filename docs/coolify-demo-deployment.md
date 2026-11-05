# Coolify demo deployments

Two vula-erp demo instances are deployed on the Vula Coolify host from the
public repo `https://github.com/hoosainmadhi/vula-erp`.

## URLs

| Customer        | URL                                        |
| --------------- | ------------------------------------------ |
| Africoach       | https://africoach-erp.vula-app.co.za       |
| Jabulani Boards | https://jabulani-boards-erp.vula-app.co.za |

Public pages: `/site` · Blog: `/blog`

## Credentials

### Africoach

| Role      | Email                       | Password             |
| --------- | --------------------------- | -------------------- |
| Admin     | `admin@africoach.local`     | `AfricoachDemo2026!` |
| Sales     | `sales@africoach.local`     | `AfricoachDemo2026!` |
| Warehouse | `warehouse@africoach.local` | `AfricoachDemo2026!` |
| Accounts  | `accounts@africoach.local`  | `AfricoachDemo2026!` |
| Employee  | `thandi@africoach.local`    | `EmployeeDemo2026!`  |

### Jabulani Boards

| Role          | Email                          | Password            |
| ------------- | ------------------------------ | ------------------- |
| Admin         | `admin@jabulani.local`         | `JabulaniDemo2026!` |
| Sales         | `sales@jabulani.local`         | `JabulaniDemo2026!` |
| Workshop      | `workshop@jabulani.local`      | `JabulaniDemo2026!` |
| Accounts      | `accounts@jabulani.local`      | `JabulaniDemo2026!` |
| Employee      | `thabo@jabulani.local`         | `EmployeeDemo2026!` |
| Workshop lead | `workshop.lead@jabulani.local` | `WorkshopDemo2026!` |

## Employee self-service

Employees sign in with their own account and land on **My Leave**. They can see
their own balances, apply for leave, and cancel a pending request. They do not
see the company dashboard, other employees’ leave, or HR/admin screens.

The employee login is linked to an employee record by matching the user email to
the employee email. Administrators can also link manually by using the same email
on both records.

## Coolify resources

| Item              | Value                                             |
| ----------------- | ------------------------------------------------- |
| Project           | `ERP` (`myvufcyo8hsssb6w8dnr4xc8`)                |
| Africoach app     | `vula-erp-africoach` (`3kbqq3f1zsd0ldzsj53drwdq`) |
| Jabulani app      | `vula-erp-jabulani` (`2r7w12cflfcfpnvaeaman5yd`)  |
| Build pack        | Dockerfile (`/Dockerfile`)                        |
| Internal port     | `3000`                                            |
| Persistent volume | `/data` (named volume per app)                    |
| Repo              | `https://github.com/hoosainmadhi/vula-erp`        |

The repo is public because Coolify's GitHub App did not have access to the new
private repo. To make it private later, add the repo to the Coolify GitHub App
and recreate the applications with the private-GitHub-app build pack.

## Environment

Both apps use:

```text
NODE_ENV=production
PORT=3000
DB_PATH=/data/vula-erp.db
JWT_SECRET=<generated per app>
APP_URL=https://<app-domain>
SEED_SCRIPT=seed-africoach | seed-jabulani
LOG_LEVEL=info
TRUST_PROXY=1
```

The container entrypoint seeds the database on first boot when `DB_PATH` does
not exist. The seed scripts are compiled to `dist/scripts/seed-africoach.js` and
`dist/scripts/seed-jabulani.js`.

## Redeploy

Coolify auto-deploy is off. Redeploy from the Coolify UI, or:

```bash
# Set these from the control-plane .env or the Coolify UI
COOLIFY_API_URL=...
COOLIFY_API_TOKEN=...

curl -X POST \
  -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
  "$COOLIFY_API_URL/api/v1/deploy?uuid=<app-uuid>&force=true"
```

## Reset demo data

The database lives in the app's `/data` volume. To reset:

1. Stop the application in Coolify.
2. Delete or rename the app's persistent volume.
3. Redeploy. The entrypoint will seed a fresh database.

## Notes

- Each app has its own database; they do not share data.
- Health checks are disabled in Coolify (`health_check_enabled=false`), so the
  app status can read `running:unknown` even when `/health` and the UI are up.
- This is a demo deployment, not production-hardened. Replace the demo users,
  passwords and JWT secrets before any real use.
