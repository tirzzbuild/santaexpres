# SANTACHAT — Web MVP

SANTACHAT is a React + TypeScript + Vite chat MVP with a Supabase backend. It uses an original dark-purple visual identity and responsive layout for desktop and mobile.

## Current scope

Implemented in source:
- Supabase Auth sign-up and email/password sign-in.
- User profile row created by a database trigger; edit display name and bio.
- Username search (prefix match).
- Create/find direct conversations through a server-side Postgres function.
- Realtime text messages and persisted message history (latest 100 per chat).
- Private image upload (up to 5 MB), stored in Supabase Storage; image access via signed URLs.
- Dark/light theme toggle for the current session.
- Vercel and Netlify SPA fallback configuration.

Not implemented yet:
- Username-only login. The current MVP signs in with email + password; username is used for discovery. Do not put a service-role key in the browser to implement username lookup.
- Password reset/change UI, unique username changes, avatars upload, receipts/read state, typing indicators, online presence, pagination, edit/delete/reply/reactions, video/document upload, voice notes, statuses, channels, push notifications, blocking/reporting, account deletion, voice/video calls.
- End-to-end encryption. Messages are protected by authenticated access policies but are not E2E encrypted.
- Production abuse controls / rate limits and automated end-to-end tests.

The UI may show placeholder status for features not yet configured; do not treat these as working features.

## Requirements

- Node.js 20 or newer recommended.
- A Supabase project.
- npm and a GitHub account for deployment.

## 1. Create Supabase project

1. Create a project in the Supabase dashboard.
2. Open **SQL Editor** and run `supabase/migrations/202610240001_santachat_mvp.sql`.
3. In **Project Settings → API** (or API Keys), copy the project URL and the publishable/anon key. These are the only Supabase credentials intended for frontend use.
4. In **Authentication → URL Configuration**, set your local site URL to `http://localhost:5173`. Add your production Vercel/Netlify URL(s) to Redirect URLs.
5. For the first MVP, configure email/password auth as desired. If email confirmations are enabled, users need to confirm their email before signing in.

> Security: never use `service_role` or a secret key in `VITE_*` variables, frontend code, or GitHub. RLS is not a replacement for careful testing.

## 2. Run locally

```bash
npm install
cp .env.example .env
```

Edit `.env`:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your_publishable_or_anon_key
```

Then run:

```bash
npm run dev
```

Open the local URL printed by Vite (usually `http://localhost:5173`).

Production build commands:

```bash
npm run typecheck
npm run build
npm run preview
```

## 3. Create two test accounts

1. Open the app in a normal browser window and register account A.
2. If email verification is on, verify account A.
3. Open a private/incognito window or another browser and register account B.
4. Sign in to both accounts. Search the other account by username and start a conversation.
5. Send text from A; confirm it appears in B without refreshing. Send a small PNG/JPEG/WebP/GIF and confirm the recipient can open it.

## 4. Deploy to Vercel

1. Push this project to a GitHub repository.
2. In Vercel, **Add New → Project** and import the repository.
3. Framework preset: **Vite**. Build command: `npm run build`; output directory: `dist`.
4. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in project Environment Variables for the required environments.
5. Deploy. Add the Vercel URL to Supabase Auth URL Configuration → Redirect URLs.
6. Redeploy after changing environment variables.

`vercel.json` includes an SPA rewrite so client-side routes can be refreshed.

## 5. Deploy to Netlify

1. Push this project to GitHub.
2. In Netlify, **Add new site → Import an existing project**.
3. Build command: `npm run build`; publish directory: `dist`.
4. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Site configuration → Environment variables.
5. Deploy. Add the Netlify URL to Supabase Auth URL Configuration → Redirect URLs.
6. Redeploy after changing environment variables.

`netlify.toml` includes an SPA fallback redirect.

## 6. Security notes

- All main tables have RLS enabled.
- Profiles are visible to authenticated users for username discovery. Only the owner may update their own profile. The schema does not expose email in `profiles`.
- Conversations/messages are readable only by conversation members. The RPC function validates the authenticated caller and recipient before creating a direct conversation.
- The `chat-media` bucket is private; storage policies require conversation membership and user-scoped upload paths.
- Supabase publishable/anon keys are designed to be public only when RLS and policies are correctly configured.
- Before production, review SQL policies with your own security test accounts, add server-side rate limits, and test signup edge cases and concurrent conversation creation.

## 7. Known MVP limitations

- The current form asks for username, email, and password at signup, but login requires email + password. Username-only login needs a carefully designed server-side flow and rate limiting; the placeholder Edge Function is intentionally disabled.
- The app currently treats image messages as private storage paths; recipients get a signed URL when clicking “Buka foto”.
- Current message history loads the latest 100 rows in ascending order; older-message pagination is not yet implemented.
- The UI is a starting MVP, not a fully audited production messaging service.
- Web Push requires a service worker, VAPID configuration, and a server-side push sender; not included.
- Voice/video calls require WebRTC signaling and TURN infrastructure; not included.

## Troubleshooting

- **“Hubungkan ruang chat kamu”**: `.env` is missing or invalid. Restart Vite after editing it.
- **Signup works but profile doesn't appear**: inspect the `handle_new_user` trigger and Supabase Auth logs; check whether the username is already taken.
- **Cannot send messages**: confirm both users are members of the same conversation and check RLS errors in browser console / Supabase logs.
- **Image upload fails**: verify migration ran, bucket `chat-media` is private, file type is allowed, and the user is a member of the conversation.
- **Realtime doesn't update**: confirm `public.messages` is included in the `supabase_realtime` publication.
