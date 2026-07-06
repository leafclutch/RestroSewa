-- Waiter assignment per table (nullable — unassigned by default)
alter table restaurant_tables
  add column if not exists assigned_user_id uuid references restaurant_users(id) on delete set null;

-- Room sessions: direct room link so customers can order from rooms without a room_stay record
alter table sessions
  add column if not exists room_id uuid references rooms(id) on delete set null;
