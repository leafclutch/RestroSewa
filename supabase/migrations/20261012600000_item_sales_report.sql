-- =============================================================
-- ITEM SALES REPORT — how many of each menu item were sold in a period
--
-- "Sold" means BILLED: a line counts once its session has a payment, and it lands
-- on the payment's date — the same moment Sales books the bill, so the two screens
-- agree about which day a plate belongs to. An open table's items are not sold yet.
--
-- Units are `active_quantity` (quantity − cancelled_quantity), exactly what the bill
-- charges; revenue is item_price × active_quantity, i.e. GROSS — before any bill-level
-- discount, which belongs to the bill and cannot honestly be split back onto lines.
--
-- A payment hangs off EITHER a session or a room stay (payments_source_check XOR). A
-- stay's payment covers every session of that stay. `distinct on (session_id)` makes
-- sure a session reachable through both arms is still counted once.
--
-- Aggregated in SQL rather than in the app: production holds 30k+ item rows and the
-- API caps a response at 1000, so a JS-side tally would silently stop counting.
-- =============================================================

create or replace function item_sales_report(
  p_restaurant_id uuid,
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  menu_item_id  uuid,
  variant_id    uuid,
  item_name     text,
  category_id   uuid,
  category_name text,
  is_custom     boolean,
  quantity      bigint,
  revenue       numeric,
  bills         bigint
)
language sql
stable
security definer
set search_path = public
as $function$
  with pay as (
    select p.id, p.session_id, p.room_stay_id, p.created_at
    from payments p
    where p.restaurant_id = p_restaurant_id
      and (p_from is null or p.created_at >= p_from)
      and (p_to   is null or p.created_at <  p_to)
  ),
  billed as (
    select distinct on (x.session_id) x.session_id, x.payment_id
    from (
      select s.id as session_id, pay.id as payment_id, pay.created_at
        from pay join sessions s on s.id = pay.session_id
      union all
      select s.id, pay.id, pay.created_at
        from pay join sessions s on s.room_stay_id = pay.room_stay_id
       where pay.room_stay_id is not null
    ) x
    order by x.session_id, x.created_at
  ),
  lines as (
    select i.menu_item_id, i.variant_id, i.item_name, i.is_custom,
           i.item_price, i.active_quantity, b.payment_id
    from billed b
    join session_orders o       on o.session_id = b.session_id
    join session_order_items i  on i.order_id   = o.id
    where i.active_quantity > 0
  )
  select
    l.menu_item_id,
    l.variant_id,
    -- Current menu name when the item still exists (a rename shows everywhere at
    -- once); otherwise the snapshot taken when it was ordered.
    coalesce(
      case when m.id is not null and v.id is not null then m.name || ' (' || v.name || ')' end,
      m.name,
      max(l.item_name)
    )                                   as item_name,
    c.id                                as category_id,
    c.name                              as category_name,
    bool_or(l.is_custom)                as is_custom,  -- constant within a group
    sum(l.active_quantity)::bigint      as quantity,
    sum(l.item_price * l.active_quantity) as revenue,
    count(distinct l.payment_id)::bigint as bills
  from lines l
  left join menu_items         m on m.id = l.menu_item_id
  left join menu_item_variants v on v.id = l.variant_id
  left join menu_categories    c on c.id = m.category_id
  -- An item no longer on the menu (or a custom line) has no id to group by, so its
  -- EXACT name is the identity: custom lines typed the same way share one row, any
  -- difference in spelling stays a separate row. `is_custom` is part of the key so a
  -- custom line never merges with a since-deleted menu item that had the same name.
  group by l.menu_item_id, l.variant_id, m.id, m.name, v.id, v.name, c.id, c.name,
           case when l.menu_item_id is null then l.item_name end,
           case when l.menu_item_id is null then l.is_custom end
  order by quantity desc, revenue desc;
$function$;

revoke all on function item_sales_report(uuid, timestamptz, timestamptz) from public;
grant execute on function item_sales_report(uuid, timestamptz, timestamptz) to service_role;
