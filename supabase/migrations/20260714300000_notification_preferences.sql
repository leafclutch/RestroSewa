-- =============================================================
-- PER-USER NOTIFICATION PREFERENCES
--
-- Which categories of alert a staff member is willing to be interrupted by.
--
-- STORES ONLY THE EXCEPTIONS. A missing row means the category is ON. That is the
-- important design decision here, and it is not laziness:
--
--   • Default-on means a NEW alert type reaches people the day it ships, instead of
--     silently going nowhere until every staff member happens to open a settings
--     screen and tick a box they have never heard of.
--   • It also means adding a category is a code change, not a backfill. There is no
--     migration that has to invent a preference row for every user who already
--     exists — and no window in which half the staff have one and half don't.
--
-- So `enabled = false` rows are mutes, and the absence of a row is consent.
--
-- The preference is per USER, not per device: a waiter who mutes Finance means it,
-- and should not have to mute it again on the till. (Whether a given DEVICE gets
-- push at all is a separate question, answered by push_subscriptions.)
-- =============================================================

create table if not exists notification_preferences (
  id uuid primary key default gen_random_uuid(),

  restaurant_user_id uuid not null references restaurant_users(id) on delete cascade,

  -- Matches NOTIFICATION_CATEGORIES in lib/push/categories.ts. Deliberately TEXT and
  -- not an enum: an enum would make adding a category a migration that has to run
  -- before the code that uses it, and `alter type ... add value` cannot run inside a
  -- transaction with other DDL. The set of categories is owned by the application,
  -- and a stale row for a category that no longer exists is simply ignored on read.
  category text not null,

  enabled boolean not null default true,

  updated_at timestamptz not null default now(),

  -- One preference per category per person.
  unique (restaurant_user_id, category)
);

create index if not exists idx_notif_prefs_user on notification_preferences (restaurant_user_id);

-- Same posture as every other table here: RLS on, no policies. Only the
-- permission-checked server actions touch it.
alter table notification_preferences enable row level security;
