-- Many-to-many: employee ↔ tables (replaces the single assigned_user_id column approach)
create table if not exists restaurant_user_tables (
  restaurant_user_id  uuid not null references restaurant_users(id) on delete cascade,
  restaurant_table_id uuid not null references restaurant_tables(id) on delete cascade,
  created_at          timestamptz not null default now(),
  primary key (restaurant_user_id, restaurant_table_id)
);

create index if not exists rut_user_idx  on restaurant_user_tables(restaurant_user_id);
create index if not exists rut_table_idx on restaurant_user_tables(restaurant_table_id);

-- Many-to-many: employee ↔ rooms
create table if not exists restaurant_user_rooms (
  restaurant_user_id uuid not null references restaurant_users(id) on delete cascade,
  room_id            uuid not null references rooms(id) on delete cascade,
  created_at         timestamptz not null default now(),
  primary key (restaurant_user_id, room_id)
);

create index if not exists rur_user_idx on restaurant_user_rooms(restaurant_user_id);
create index if not exists rur_room_idx on restaurant_user_rooms(room_id);
