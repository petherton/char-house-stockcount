# Char House Stock Count

Scan-based stock count tool. Staff sign in with their Google account, scan
barcodes (Bluetooth/USB HID scanner or a Honeywell handheld — both just type
into the on-screen field like a keyboard), enter the quantity on hand for
each item, and export a CSV in the exact format Lightspeed's own stock-count
import expects (`id,name,count`).

Built to start with the Bottle Shop and expand to the rest of the group —
every table is already keyed by `venue_id`, so adding a venue is just an
insert into `venues` plus a product seed for that site.

## How it's built

- **Next.js 14** (App Router) — the web app
- **Supabase** — Postgres database, Google-account authentication, row-level
  security so only allow-listed staff emails can use it
- **Railway** — hosting

## One-time setup

### 1. Google OAuth client (needed regardless of where this is hosted)

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials).
2. Create a project (or use an existing one) for The Char House.
3. **Create Credentials → OAuth client ID** → Application type **Web application**.
4. Under **Authorized redirect URIs**, add your Supabase callback URL:
   `https://<your-project-ref>.supabase.co/auth/v1/callback`
5. Save the **Client ID** and **Client secret** — you'll paste these into Supabase next.

### 2. Supabase project

1. Create a new Supabase project.
2. **Authentication → Providers → Google** — paste in the Client ID/secret from step 1, enable it.
3. **SQL Editor** — run `schema.sql`, then `seed.sql` (seeds the 768 current Bottle Shop products).
4. Add each staff member's Google account email to `staff_allowlist` (Jy's is seeded as admin already):
   ```sql
   insert into staff_allowlist (email, display_name) values ('name@gmail.com', 'Full Name');
   ```
5. Grab your **Project URL** and **anon public key** from Settings → API.

### 3. Deploy

Set these two environment variables wherever it's hosted:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

Then `npm install && npm run build && npm start`.

## Adding a new venue later

```sql
insert into venues (id, name) values ('restaurant', 'Restaurant');
```

Then seed that venue's `products` rows (same shape as `seed.sql`) with its
own Lightspeed product export. Staff will see a venue switcher automatically
once more than one venue exists.

New venues also get created automatically by the live stock feed below, the
first time it sees a site it doesn't recognise.

## Live stock feed (Lightspeed Insights → webhook)

`/api/webhooks/lightspeed-stock/[token]` receives the "Stock Count Product
Feed" Look scheduled out of Lightspeed Insights (Explore → Stock Levels →
saved as a Look → Schedule → Webhook → format **JSON — Simple, Inline**) and
keeps `venues`, `products` and `product_stock_levels` up to date for every
site Lightspeed reports on — not just Bottle Shop.

Setup:

1. Set `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Settings → API) and
   `LIGHTSPEED_WEBHOOK_SECRET` (any long random string) on the host.
2. In the Insights schedule, set the Webhook URL to
   `https://<your-host>/api/webhooks/lightspeed-stock/<LIGHTSPEED_WEBHOOK_SECRET>`.
3. `GET` the same URL (with the token) to confirm it's live; `Send Test` from
   the schedule dialog to confirm the pipeline end to end.

Matching notes: the Insights "Stock Level" explore doesn't expose
Lightspeed's real internal product id, so the route matches incoming rows
onto existing `products` by barcode first, then SKU, and only invents a new
identity (Product Number, else barcode, else SKU) for a product it's never
seen before — so it can't silently disconnect Bottle Shop's existing
products from the real Lightspeed ids they were seeded with. Each run is
logged to `webhook_runs` (rows received, matched/created counts, skips).
