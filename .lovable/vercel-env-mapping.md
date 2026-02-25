# Vercel Environment Variable Mapping

> **Important:** Lovable Cloud secrets do **NOT** automatically sync to Vercel.
> You must manually add each required variable in **Vercel Project Settings → Environment Variables**.

## Required Variables

| Variable Name | Build | Runtime | Client-Exposed | Notes |
|---|---|---|---|---|
| `VITE_SUPABASE_URL` | ✅ | ✅ | ✅ | Prefixed with `VITE_` so Vite injects it into the client bundle |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ✅ | ✅ | ✅ | Anon/public key — safe to expose |
| `RESEND_API_KEY` | ❌ | ✅ | ❌ | Used by edge functions only; do **not** expose to client |

## Checklist

- [ ] Add `VITE_SUPABASE_URL` in Vercel (copy value from Lovable Cloud)
- [ ] Add `VITE_SUPABASE_PUBLISHABLE_KEY` in Vercel (copy value from Lovable Cloud)
- [ ] Add `RESEND_API_KEY` in Vercel **only** if you run backend functions there (edge functions remain on Lovable Cloud)

## Notes

- Variables prefixed with `VITE_` are embedded at **build time** and visible to the client.
- Private keys (no `VITE_` prefix) are server-side only and should never be exposed to the browser.
- Edge functions deployed on Lovable Cloud already have access to secrets configured there — you only need Vercel env vars for the **frontend build**.
