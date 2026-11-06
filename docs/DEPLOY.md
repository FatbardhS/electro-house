# Putting Electro House online (free test setup)

One **Render** free web service runs the server and the app on one address; **Supabase** (free) provides the
PostgreSQL database and the file storage for plan PDFs. Billing is switched off: every company has full access.
No credit card is needed for either service. About 15 minutes.

**Free-tier limits:** Render sleeps after ~15 minutes without visitors (the next visit takes about a minute);
the free instance has 512 MB of memory, so very large plan PDFs (≈ 50 MB and more) may fail to upload;
Supabase pauses a free project after a week without use (resume it with one click in Supabase).

---

## 0. The code must be on GitHub

Render deploys from your GitHub repository `FatbardhS/electro-house` (branch `main`). Push the latest commits first.

## 1. Supabase: database and file storage

1. Go to **supabase.com** → sign up (GitHub sign-in is fine) → **New project**.
   - Name: `electro-house`, choose a **database password** (save it), region **Central EU (Frankfurt)**.
2. **Database address** → button **Connect** (top of the project page) → tab **Connection string** →
   choose **Session pooler**. Copy the URI, it looks like
   `postgresql://postgres.abcdefghij:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`
   and replace `[YOUR-PASSWORD]` with your database password. This is **`DATABASE_URL`**.
   (Use the *session pooler*, not the *direct connection*: Render cannot reach the direct one.)
3. **Storage bucket** → **Storage** → **New bucket** → name **`plans`**, leave *Public bucket* **off** → Create.
4. **Storage keys** → **Storage** → **Settings** (or *S3 Connection*) → make sure *S3 connection* is enabled.
   Note the **Endpoint** (`https://abcdefghij.storage.supabase.co/storage/v1/s3`) and the **Region**
   (e.g. `eu-central-1`). Then **New access key** → copy the **Access key ID** and the **Secret access key**
   (the secret is shown only once).

## 2. Render: the app

1. Go to **render.com** → sign up with GitHub → allow access to the `electro-house` repository.
2. **New** → **Blueprint** → pick the `electro-house` repository. Render reads `render.yaml` and shows one service,
   `electro-house` (free). It asks for these values:

   | Setting | Value |
   |---|---|
   | `WEB_ORIGIN` | `https://electro-house.onrender.com` (see the note below) |
   | `DATABASE_URL` | the session-pooler URI from step 1.2 |
   | `S3_ENDPOINT` | the endpoint from step 1.4 |
   | `S3_REGION` | the region from step 1.4 |
   | `S3_ACCESS_KEY_ID` | the access key ID from step 1.4 |
   | `S3_SECRET_ACCESS_KEY` | the secret access key from step 1.4 |

   Everything else is already set in `render.yaml` (production mode, Node 24, bucket `plans`, billing off).
3. **Apply**. The first build takes about 5–10 minutes. The log ends with
   `Serving the web app from …` and `Electro House API listening …`; the database tables are created
   automatically on the first start.
4. **Check the address.** Open the service in Render; its address is at the top. If it is **not** exactly
   `https://electro-house.onrender.com` (Render adds a suffix when the name is taken), go to **Environment**, set
   `WEB_ORIGIN` to the real address (no slash at the end) and save: Render redeploys by itself. Without this,
   signing in fails with "Request origin not allowed".

## 3. First use

The online database starts empty: open the address and **create your account** (sign up). Invite colleagues from
**Settings → Team**: copy the invitation link and send it to them.

## Updating

Every push to `main` deploys automatically (`autoDeploy` in `render.yaml`); database migrations run on start.

## Later

- **Own domain:** Render → service → **Settings → Custom Domains**; then set `WEB_ORIGIN` to the new address.
- **Billing:** set `BILLING_PROVIDER=paddle` and the `PADDLE_*` settings (see `apps/api/.env.example`) in Render's
  Environment page; no code change is needed.
- **Always on / more memory:** Render's paid *Starter* instance (no sleeping, 512 MB → more on larger plans).

## If something goes wrong

| Symptom | Cause / fix |
|---|---|
| Build fails with "Invalid environment configuration" at start | A setting is missing or misspelt: the log lists which one. |
| "Request origin not allowed" when signing in | `WEB_ORIGIN` does not match the address in the browser. |
| `/api/health` answers 503 | The database is not reachable: check `DATABASE_URL` (session pooler, password filled in) and that the Supabase project is not paused. |
| Plan upload or plan view fails | Check the bucket name `plans` and the four `S3_*` values; the access key must belong to the same project. |
| The first page load takes ~1 minute | The free instance was asleep; that is normal on the free plan. |
