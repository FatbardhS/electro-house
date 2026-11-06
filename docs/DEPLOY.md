# Putting Electro House online (free test setup)

Everything runs on **Render's free tier**: one web service (server + app on one address) and one PostgreSQL
database (data and plan PDFs). The blueprint `render.yaml` creates and connects both. **No passwords or keys to
copy**, no credit card. Billing is switched off: every company has full access.

## Steps (about 5 minutes + 5–10 minutes build)

1. Open **https://dashboard.render.com/register** and sign up **with GitHub**.
2. Open **https://dashboard.render.com/blueprint/new**, connect GitHub if asked, and give Render access to the
   repository **FatbardhS/electro-house**.
3. Select **electro-house** → Render shows `electro-house` (web service, free) and `electro-house-db`
   (PostgreSQL, free) → **Deploy Blueprint** (Render may call it *Apply*).
4. Wait until the web service shows **Live**. Its address is at the top, e.g. `https://electro-house.onrender.com`.
5. Open the address and **create your account** (the online database starts empty). Invite colleagues from
   **Settings → Team**.

Every push to `main` deploys again automatically; database migrations run on start.

## Free-tier limits

- **The app sleeps** after ~15 minutes without visitors; the next visit takes about a minute.
- **The free database is deleted 30 days after it was created** (Render sends a warning first). To keep the data,
  upgrade the database to a paid plan before then, or export what you need.
- 512 MB memory and 1 GB database: fine for testing; very large plan PDFs (≈ 50 MB+) may fail to upload.

## Later

- **Own domain:** Render → web service → **Settings → Custom Domains**, then add the setting
  `WEB_ORIGIN=https://your.domain` under **Environment**.
- **Billing:** set `BILLING_PROVIDER=paddle` and the `PADDLE_*` settings (see `apps/api/.env.example`).
- **Bigger installations:** move files to S3-compatible storage (`STORAGE_DRIVER=s3`, `S3_*` settings,
  `S3_PROXY_READS=true`) and use a paid database.

## If something goes wrong

| Symptom | Cause / fix |
|---|---|
| Deploy fails with "Invalid environment configuration" | The log lists the missing setting. |
| "Request origin not allowed" when signing in | You use another address than Render's (e.g. a custom domain): set `WEB_ORIGIN` to it. |
| `/api/health` answers 503 | The database is not reachable: check that `electro-house-db` is *Available* in Render. |
| The first page load takes ~1 minute | The free instance was asleep; normal on the free plan. |
