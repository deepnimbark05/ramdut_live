/* ============================================================
   રામદૂત સ્ટોક મેનેજર — FREE Cloud Database configuration
   ============================================================
   Recommended provider: Supabase (lifetime free — no credit card)

   SETUP (about 5 minutes, see DATABASE_SETUP.md):
   1) https://supabase.com → sign up free → "New project"
   2) SQL Editor → paste the SQL from DATABASE_SETUP.md → Run
   3) Project Settings → API → copy:
        • Project URL  → paste below in  url
        • anon public  → paste below in  anonKey
   4) Deploy the site — header badge must show 🟢 Cloud

   Leave url / anonKey empty → the app keeps using the local
   server (_server.js + SQLite) exactly as before.
   ============================================================ */
window.RAMDUT_DB = {
  provider: 'supabase',   // 'supabase' = cloud, anything else = local /api/state
  url: 'https://ooevidhqxwseokakmrkq.supabase.co',                // e.g. 'https://abcdefghijkl.supabase.co'
  anonKey: 'sb_publishable_-fLah3V3nqDFCSwmSPxI4g_AfbCAi4-',            // e.g. 'eyJhbGciOiJIUzI1NiIsInR5cCI6...'
  storeId: 'main',        // change to any long random text to isolate your data
};
