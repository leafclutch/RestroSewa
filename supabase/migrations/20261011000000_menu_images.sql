-- =============================================================
-- MENU CARD PHOTOS
--
-- Photos of a restaurant's printed menu card, uploaded by the admin (or staff
-- with Manage Menu) and shown to guests on the QR menu from a right-edge
-- "Menu card" button. One gallery per restaurant, ordered by sort_order.
--
-- Table: RLS on, no policies — every read and write goes through server
-- actions running as the service role (app/actions/menu-images.ts), which
-- check the caller's permission first. Same model as the rest of the app.
--
-- Bucket: PUBLIC, like restaurant-logos (20260712300000): guests scanning a
-- QR code are anonymous, and a menu card is public by nature. The mime list
-- and 3 MB cap are enforced by Storage itself, so skipping the server action
-- still can't upload anything else. Photos are shrunk in the browser before
-- upload (lib/image-resize.ts), so 3 MB is ample.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.menu_images (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  url           text NOT NULL,
  path          text NOT NULL,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS menu_images_restaurant_order_idx
  ON public.menu_images (restaurant_id, sort_order, created_at);

ALTER TABLE public.menu_images ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.menu_images TO service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'menu-images',
  'menu-images',
  true,
  3145728,  -- 3 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
