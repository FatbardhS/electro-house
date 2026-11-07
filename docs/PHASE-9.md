# Phase 9: product owner admin panel

A page at `/admin` for the product owner: who uses Electro House and what they do, across all companies.

## Access

- Only accounts whose email is in the API setting `PLATFORM_ADMIN_EMAILS` (comma-separated) can open it.
  On Render: web service → Environment. Locally: `apps/api/.env`.
- The session tells the web app `user.isPlatformAdmin`; the top menu then shows **Admin**.
- `PlatformAdminGuard` protects every `/api/admin/*` route. Anyone else gets **404** (the panel is not revealed),
  and the attempt is logged as `admin.denied`.
- The panel is read-only: it changes nothing.

## What it shows

| Tab | Content |
| --- | --- |
| Overview | users, active today / 7 / 30 days, signed in now, companies by subscription state, projects, exports this week, failed sign-ins in 24 h, a 30-day chart (active users, new accounts), latest activity |
| Users | name, email, companies and roles, last seen, last sign-in, open sessions, joined; click → details with open sessions, totals per action and the user's full activity |
| Companies | owner, subscription / trial end, members, clients, projects, last activity; click → the company's activity |
| Activity | every event, newest first, filter by action and search by email, company, project name or IP; "load older" |

## How activity is recorded

- Table `ActivityEvent` (migration `20261107120000_activity_log`). No foreign keys on purpose: the history stays
  when a user, company or project is deleted; email, company name and target name are copied in.
- Routes are marked with `@TrackActivity('project.created', …)` (apps/api/src/activity). The global
  `ActivityInterceptor` records the event after the route succeeds, with IP (`cf-connecting-ip` on Render, else
  the request address) and browser. Names of deleted things are read before the delete runs.
- Wrong-password sign-ins are logged as `auth.sign_in_failed` with the attempted email (no user id).
- Recording never fails a request: errors are only logged.
- `User.lastSeenAt` is updated by the session guard at most every 5 minutes per user (kept in memory).
- Recorded actions: sign-up, sign-in, failed sign-in, sign-out, invitations (sent, accepted, sign-up), role change,
  member removed, left company, ownership transfer, client created/deleted, project created/deleted, floor
  added/deleted, plan PDF uploaded, PDF export, DXF export, denied admin access. The list and labels are in
  `packages/shared/src/admin/admin.ts`. Page views and drawing edits are not logged (too many, little value).

## Limits

- Only activity from the day this was deployed is in the log. Users, companies and projects created earlier are
  listed; their "last sign-in" falls back to their newest session.
- Render's free database is deleted after 30 days: the log goes with it.
- Lists show the 500 most recent rows; use the search box for the rest.
- The log grows without limit. At real scale, add a clean-up of events older than e.g. a year.

## Tests

`apps/api/test/api.e2e-spec.ts` → "product owner panel": 404 for normal users (and logged), sign-ins, failed
sign-ins, created/deleted names, users/companies/overview numbers, paging.
