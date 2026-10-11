-- =============================================================
-- Real-time coverage for the admin surface.
--
-- The realtime bus (20260712100000_realtime_events.sql) only had triggers on the
-- floor's tables, so a whole class of admin writes changed nothing on any open
-- screen until a manual reload: settings (closing hour, currency…), expenses,
-- extra income, savings, rooms, staff, workstations, variants/add-ons and the
-- menu photos. This wires the rest. Same rule as before: a trigger announces
-- THAT something changed, never what — clients refetch through permission-
-- checked server code.
--
-- New topics: settings, staff, rooms, workstations, expenses, security.
-- Idempotent; safe to re-run.
-- =============================================================

-- `restaurants` IS the tenant: its own id is the restaurant id.
create or replace function rs_notify_restaurant()
returns trigger
language plpgsql
as $$
begin
  perform pg_notify('rs_events',
    json_build_object('r', coalesce(new.id, old.id), 't', 'settings')::text);
  return null;
end;
$$;

-- Variants and add-ons hang off a menu item and carry no restaurant_id.
create or replace function rs_notify_menu_child()
returns trigger
language plpgsql
as $$
declare
  v_restaurant uuid;
begin
  select mi.restaurant_id into v_restaurant
    from menu_items mi where mi.id = coalesce(new.menu_item_id, old.menu_item_id);
  if v_restaurant is not null then
    perform pg_notify('rs_events', json_build_object('r', v_restaurant, 't', 'menu')::text);
  end if;
  return null;
end;
$$;

-- Every bill bumps `bill_number_next`; that alone must NOT wake every admin
-- screen as a "settings change" on each sale. Anything else on the row does.
drop trigger if exists rs_ev_restaurants on restaurants;
create trigger rs_ev_restaurants
  after update on restaurants
  for each row
  when ((to_jsonb(old) - 'bill_number_next' - 'updated_at')
        is distinct from (to_jsonb(new) - 'bill_number_next' - 'updated_at'))
  execute function rs_notify_restaurant();

drop trigger if exists rs_ev_menu_item_variants on menu_item_variants;
create trigger rs_ev_menu_item_variants
  after insert or update or delete on menu_item_variants
  for each row execute function rs_notify_menu_child();

drop trigger if exists rs_ev_menu_item_addons on menu_item_addons;
create trigger rs_ev_menu_item_addons
  after insert or update or delete on menu_item_addons
  for each row execute function rs_notify_menu_child();

-- Every remaining table carries restaurant_id directly → the generic notifier.
-- Guarded with to_regclass so a table an older environment never got is skipped
-- rather than failing the whole migration.
do $$
declare
  w record;
begin
  for w in
    select * from (values
      ('menu_images',            'menu',         'rs_ev_menu_images'),
      ('extra_expenses',         'expenses',     'rs_ev_extra_expenses'),
      ('extra_expenses',         'finance',      'rs_ev_extra_expenses_finance'),
      ('extra_income',           'finance',      'rs_ev_extra_income'),
      ('saving_titles',          'finance',      'rs_ev_saving_titles'),
      ('room_types',             'rooms',        'rs_ev_room_types'),
      ('room_stays',             'rooms',        'rs_ev_room_stays'),
      ('room_charges',           'rooms',        'rs_ev_room_charges'),
      ('room_advances',          'rooms',        'rs_ev_room_advances'),
      ('room_advances',          'finance',      'rs_ev_room_advances_finance'),
      ('restaurant_users',       'staff',        'rs_ev_restaurant_users'),
      ('salary_cycles',          'payroll',      'rs_ev_salary_cycles'),
      ('staff_attendance_days',  'payroll',      'rs_ev_staff_attendance_days'),
      ('workstations',           'workstations', 'rs_ev_workstations'),
      ('product_workstations',   'workstations', 'rs_ev_product_workstations'),
      ('table_groups',           'tables',       'rs_ev_table_groups'),
      ('security_audit_log',     'security',     'rs_ev_security_audit_log'),
      ('report_deliveries',      'settings',     'rs_ev_report_deliveries')
    ) as v(tbl, topic, trg)
  loop
    if to_regclass('public.' || w.tbl) is null then
      continue;
    end if;
    execute format('drop trigger if exists %I on public.%I', w.trg, w.tbl);
    execute format(
      'create trigger %I after insert or update or delete on public.%I '
      'for each row execute function rs_notify_change(%L)',
      w.trg, w.tbl, w.topic
    );
  end loop;
end;
$$;
