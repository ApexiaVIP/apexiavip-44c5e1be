# Moving off Lovable

Last updated 14 October 2026.

## The short version

Most of the platform is already ours. The code lives in our own private GitHub
repo, the website is built and served by Vercel from that repo, and the iOS and
Android apps are built on this machine and submitted under our own Apple and
Google accounts. Lovable does not touch any of that.

The one thing Lovable still holds is the **managed Supabase project**
(`mzqpvnxtwshjcyzaipea`): the database, the authentication users, file storage,
the 16 edge functions and their secrets. That is the whole of the lock-in, and
it is why every database change today has to go through their agent.

So "retiring Lovable" means one job: **stand the Supabase side up in a project we
own.** Nothing else has to change.

## What is already done

`supabase/baseline/` now holds a reproducible build of the database:

| File | What it is |
| --- | --- |
| `platform.sql` | Extensions, email queues, storage buckets and their policies, the scheduled jobs |
| `schema.sql` | All 19 tables, 36 row-level-security policies, 9 functions, 49 indexes |
| `grants.sql` | Role grants on the public schema |

These were produced by replaying all 56 migration files into a clean Postgres 15
and dumping the result. Verified: a fresh empty database built from these three
files is **byte-for-byte identical** to the database built by replaying all 56
migrations. No existing migration file was modified to achieve this.

That gives us an escape hatch today. If Lovable disappeared tomorrow, the
database structure can be rebuilt in one step.

## The real blocker

Structure is solved. **Content is not.** To copy the live data we need either:

- **A.** Lovable's own export, if the Export button now exists under
  Cloud → Settings in the Lovable project. Check this first, it is the easy road.
- **B.** The Postgres connection string and password for the managed project, so
  we can run `pg_dump` ourselves.

Without one of those two, the live rows, and more importantly the **authentication
users**, cannot be moved. Members sign in passwordlessly against
`auth.users`/`auth.identities` in that project. Recreating those by hand would
mean every member and chauffeur re-registering, which is not acceptable.

**Next action: open the Lovable project, go to Cloud → Settings, and see whether
an Export option is offered.** Everything below depends on which of A or B we get.

## Phase 1: prepare, with zero risk to the live site

Can all be done while the current site keeps running untouched.

1. Create a Supabase project in our own organisation. Choose the London region.
   Note the new project ref, URL, anon key and service_role key.
2. Install the Supabase CLI and link it to the new project:
   `supabase link --project-ref <new-ref>`
3. Build the schema on the new project, in this order:
   `platform.sql`, then `schema.sql`, then `grants.sql`.
   Before running `platform.sql`, replace every `mzqpvnxtwshjcyzaipea` URL in the
   scheduled-job section with the new project ref, and uncomment the
   `vault.create_secret` line with the new service_role key.
4. Deploy the edge functions: `supabase functions deploy` picks up all 16 from
   `supabase/functions/`, and `supabase/config.toml` already carries the
   `verify_jwt` setting for each one. Change `project_id` in that file to the new
   ref at this point.
5. Set the 11 function secrets on the new project. The names are:
   `DISPATCH_TRANSFER_REFERENCE`, `GOOGLE_MAPS_API_KEY`, `RESEND_API_KEY`,
   `REVIEW_CODE`, `REVIEW_PHONE`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`,
   `TIMESHEET_RECIPIENT`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`.
   The values have to be re-entered by hand: Lovable will not reveal them, but we
   hold all of them elsewhere (Twilio console, Resend dashboard, Dever).
6. Point the Resend domain and the auth email hook at the new project.
7. Test the new project end to end against a scratch Vercel preview, with its own
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Create test members,
   test bookings, run a timesheet. The live site is unaffected throughout.

## Phase 2: cutover

Pick a quiet window. There is no fixture on the night chosen, and the office
should be told the member app may be briefly unavailable.

1. Freeze bookings on the member app for the window.
2. Copy the data. With route A, import Lovable's export. With route B:
   `pg_dump --data-only --schema=public` from the old project, restore into the
   new one, then the same for the `auth` and `storage` schemas.
3. Copy the storage objects in the `avatars` and `vcard` buckets.
4. Confirm the scheduled jobs exist on the new project and point at the new ref:
   `SELECT jobname, schedule FROM cron.job;` should list `booking-watch`,
   `driver-job-reports`, `driver-timesheet-daily`, `driver-timesheet-weekly`,
   `fixtures-sync-weekly` and `process-email-queue`.
5. Swap the two Vercel environment variables to the new project and redeploy.
   The website and the Android app pick this up immediately.
6. Build and submit a new iOS version. The iOS app bundles its web assets, so it
   keeps talking to the old project until a new build ships. **Do not retire the
   old Supabase project until that build is live and adopted.**
7. Watch for a full day: bookings reaching Dispatch, driver sign-on, the SMS
   links, the 23:00 timesheet run.

## What will not copy by itself

- **Vault secrets.** `email_queue_service_role_key` must be recreated on the new
  project with the new key. Every scheduled job fails silently without it.
- **The `process-email-queue` job.** It was never in a migration file; a setup
  tool created it directly. Capture it from the live project with
  `SELECT jobname, schedule, command FROM cron.job;` and add it to `platform.sql`
  before cutover.
- **Auth settings.** Redirect URLs, the magic-link template and the email hook
  configuration are project settings, not schema.
- **The `bookings_backup_20260818` table.** A one-off safety copy. It is in the
  baseline because it is in the live database, but it does not need its data
  carried over.

## Rollback

Until step 5 of Phase 2, rollback is: do nothing. The old project is still live
and serving.

After step 5, rollback is: swap the two Vercel environment variables back and
redeploy. Keep the old project running and paid for at least a month after
cutover, and do not delete it until the new iOS build has been out for two weeks.

## Cost

Our own Supabase project on the Pro plan is $25 a month plus usage. Against that,
every database change stops being a conversation with someone else's agent, which
is the actual reason for doing this.
