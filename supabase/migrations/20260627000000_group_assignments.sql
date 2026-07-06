-- Assign waiter(s) to an entire table group (zone/section)
-- Individual table assignments in restaurant_user_tables take priority.
create table if not exists restaurant_user_table_groups (
  restaurant_user_id uuid not null references restaurant_users(id) on delete cascade,
  table_group_id     uuid not null references table_groups(id)    on delete cascade,
  created_at         timestamptz not null default now(),
  primary key (restaurant_user_id, table_group_id)
);

create index if not exists rutg_user_idx  on restaurant_user_table_groups(restaurant_user_id);
create index if not exists rutg_group_idx on restaurant_user_table_groups(table_group_id);

-- Assign waiter(s) to an entire room type/block
-- Individual room assignments in restaurant_user_rooms take priority.
create table if not exists restaurant_user_room_types (
  restaurant_user_id uuid not null references restaurant_users(id) on delete cascade,
  room_type_id       uuid not null references room_types(id)       on delete cascade,
  created_at         timestamptz not null default now(),
  primary key (restaurant_user_id, room_type_id)
);

create index if not exists rurt_user_idx on restaurant_user_room_types(restaurant_user_id);
create index if not exists rurt_type_idx on restaurant_user_room_types(room_type_id);
