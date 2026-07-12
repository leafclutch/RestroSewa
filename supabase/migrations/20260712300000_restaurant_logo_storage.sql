-- =============================================================
-- RESTAURANT LOGOS — storage bucket
--
-- `restaurants.logo_url` already existed (unused). All this adds is somewhere to
-- put the file.
--
-- PUBLIC bucket, deliberately: a logo is shown to every guest who scans a QR
-- code, and those guests are anonymous — they hold no session and no token. A
-- private bucket would mean minting a signed URL on every page render, which
-- buys nothing: the logo is public branding, not private data.
--
-- No RLS policies are needed. Reads are public; writes only ever happen through
-- `app/actions/branding.ts`, which runs as the service role (bypassing RLS) and
-- checks super-admin FIRST. The anon key cannot write here.
--
-- The mime allow-list and size cap are enforced by Storage itself, so a
-- malicious client that skips our server action still cannot upload a payload
-- disguised as a logo.
-- =============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'restaurant-logos',
  'restaurant-logos',
  true,
  2097152,  -- 2 MB. A logo that doesn't fit is a photo, not a logo.
  array['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
