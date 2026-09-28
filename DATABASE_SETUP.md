# 💾 Free Cloud Database Setup — Lifetime Free (Supabase)

Your website can now store its data in a **cloud database that is free forever** —
no credit card, $0/month. Data lives in **Supabase (PostgreSQL)** and syncs across
all devices; the hosted site needs **no backend server** of its own.

## What "Free" includes (source: supabase.com/pricing)

| Free plan | |
|---|---|
| Database storage | **500 MB** (this app stores a few KB → lasts essentially forever) |
| Bandwidth | 5 GB/month |
| API requests | Unlimited |
| Credit card | **Not required** |
| Limit | 2 active projects |
| Inactivity | Free projects pause after 1 week of no use — **data is kept**; click *Restore project* to bring it back free |

## Setup — about 5 minutes

1. **Create a free account** → https://supabase.com → *Start your project* (login with GitHub/Google).
2. **New project** → plan: Free → wait ~2 minutes until it says *All migrations completed*.
3. Left menu → **SQL Editor** → *New query* → paste this and click **Run**:

```sql
-- One row holds the whole app state (settings, items, sites, history)
create table if not exists public.app_state (
  id         text primary key,
  state      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Let the public (anon) key read/write — this app has no login
alter table public.app_state enable row level security;

create policy "anon_full_access" on public.app_state
  for all to anon
  using (true)
  with check (true);

insert into public.app_state (id, state)
values ('main', '{}'::jsonb)
on conflict (id) do nothing;
```

4. **Gear icon → API** → copy two values into `db-config.js`:

| Supabase dashboard | `db-config.js` |
|---|---|
| Project URL (`https://xxxx.supabase.co`) | `url: '...'` |
| anon public key (`eyJ...`) | `anonKey: '...'` |

5. **Deploy** (push to GitHub → your host) and open the site.
   The header badge must show **`🟢 Cloud`**.

**Verify:** add an item → open the site on another phone/browser → the item appears.
You can also see the data in *Table Editor → app_state*.

## How the two modes work

| `db-config.js` | Badge | Data lives in |
|---|---|---|
| `url` + `anonKey` filled | `🟢 Cloud` | Supabase PostgreSQL — same data on every device |
| empty (default) | `🟢 DB` | Local `_server.js` + `ramdut.db` (old behaviour) |
| connection failed / offline | `🟠 offline` | This device's localStorage — auto-syncs when back online (600 ms debounce) |

Internally `app.js` keeps the exact same two operations as before
(`GET` state on load, `POST` state on save); in cloud mode they map to:

- `GET  {url}/rest/v1/app_state?select=state&id=eq.main`
- `POST {url}/rest/v1/app_state` with header `Prefer: resolution=merge-duplicates` (upsert)

CORS is enabled automatically by Supabase, so the browser can call it directly
from GitHub Pages / Netlify / Vercel / Cloudflare Pages.

## ⚠️ Security — please read

- The **anon key is designed to be public** (it ships in every Supabase web app).
  With the policy above, **anyone who knows your project URL + anon key can read or
  write your stock data**. That is fine for shop inventory counts, but
  **do not** store passwords, payments or personal customer data here.
- Make your data hard to stumble upon: change `storeId` in `db-config.js` to a long
  random text (e.g. `'rmd-7f2a9c41xyz'`) instead of `'main'`, and keep the repository
  private if you can. A new `storeId` starts a fresh, empty data set.
- Need real security later? Add Supabase Auth (email login) and tighten the policy:
  https://supabase.com/docs/guides/auth

## Backup

- **In-app:** Settings → 💾 Backup / 📥 Restore (JSON file) — unchanged.
- **Cloud:** Supabase Dashboard → Table Editor → `app_state`. Your row is kept even
  if the free project gets paused.

## FAQ

**Q: My project says "Paused"?** → Normal on the Free plan after 1 week of no use.
Open the Supabase dashboard → project → **Restore project** (free, data intact).

**Q: How do I switch back to local-only?** → Empty `url` / `anonKey` in `db-config.js`.

**Q: Multiple devices?** → All devices using the same `storeId` share one data set.
The server state is the source of truth at page load; every save is pushed.

**Q: Why Supabase instead of Firebase / MongoDB / Neon?** → Firebase can delete
long-inactive projects, and MongoDB/Neon/Turso need a server-side driver (a static
website cannot call them directly). Supabase is free forever *and* callable from the
browser with plain REST.

## Files touched

- `db-config.js` — **your credentials go here** (new)
- `app.js` — DB layer now supports cloud + local modes
- `index.html` — loads `db-config.js`, dynamic data note
- `sw.js` — caches `db-config.js` (cache `ramdut-stock-v16`)
- `tests/cloud-sync.test.js` — run `node tests/cloud-sync.test.js` to verify sync
