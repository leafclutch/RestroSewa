-- =============================================================
-- WEB PUSH SUBSCRIPTIONS
--
-- One row per BROWSER, not per person. A waiter with the app installed on a phone
-- and open on the till has two subscriptions and should be woken on both — so the
-- unit of identity here is the endpoint the push service handed the browser, and a
-- staff member simply has as many rows as they have devices.
--
-- WHY NOT FIREBASE: on the web, FCM's SDK is a wrapper over this same standard Push
-- API. It would buy no extra reach — only a Google dependency and a second place for
-- delivery to break. So the endpoint/p256dh/auth triple below IS the subscription,
-- exactly as the browser produced it, and `web-push` signs to it with our VAPID key.
--
-- ROUTING IS NOT STORED HERE. Who receives a given event is decided at SEND time by
-- the same buildVisibilityFilter()/permission logic that decides who may SEE it
-- (lib/push/send.ts). Denormalising "which alerts does this device want" into this
-- table would create a second, staler copy of the permission model — and the first
-- time the two disagreed, a push would reach someone who is not allowed to open the
-- screen it links to.
-- =============================================================

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),

  restaurant_id      uuid not null references restaurants(id)      on delete cascade,
  -- Cascades, which is what lets delete_restaurant_cascade() keep working untouched:
  -- it already deletes restaurant_users explicitly, and these go with them.
  restaurant_user_id uuid not null references restaurant_users(id) on delete cascade,

  -- The push service's URL for this browser. Globally unique by construction — the
  -- same device re-subscribing gets the same endpoint back, so this is the natural
  -- key and an upsert target.
  endpoint text not null unique,

  -- The browser's public key and auth secret. Payloads are encrypted TO these, so
  -- the push service (Google/Apple/Mozilla) relays ciphertext it cannot read.
  p256dh text not null,
  auth   text not null,

  -- Only so a staff member can tell their own devices apart when revoking one.
  user_agent text,

  created_at   timestamptz not null default now(),
  -- Bumped every time the browser re-affirms the subscription, so a device that has
  -- not opened the app in months is identifiable as dormant rather than dead.
  last_seen_at timestamptz not null default now(),

  -- Delivery health. A push service answers 404/410 when a subscription is dead
  -- (app uninstalled, browser data cleared) and we delete on the spot. But a
  -- transient 5xx must NOT delete anything, so failures are counted instead and
  -- the row is only reaped once it has failed persistently.
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count   int not null default 0
);

create index if not exists idx_push_subs_user       on push_subscriptions (restaurant_user_id);
create index if not exists idx_push_subs_restaurant on push_subscriptions (restaurant_id);

-- Same posture as every other table in this schema: RLS on, no policies. The browser
-- never reads these directly — only the service-role server actions do. A staff
-- member's device credentials are not something another staff member should be able
-- to enumerate with the anon key.
alter table push_subscriptions enable row level security;
