-- =============================================================
-- THE LEDGER NAMES ITS SALES
--
-- A sale row said only "Sale". An owner reading the transaction history could
-- not tell a restaurant bill from a hotel one, nor which table or room it came
-- from — while the Sales block above it has been split by source since
-- 20260812200000. Two views of the same money, one of them mute.
--
-- Adds `source` ('room' | 'walkin' | 'table' | null) and `source_label`
-- ("Room 203", "Table 5", "Walk-in 1"). `kind` deliberately stays 'sale': the
-- ledger groups and reconciles by kind, and splitting it would ripple into
-- FinanceTxKind, TX_LABEL and every reader, to say something a second column
-- says without disturbing anything.
--
-- `party` is untouched — it still carries the credit customer's name, so a
-- credit sale can now read "Room sale · Room 203 · Ram Bahadur" and lose nothing.
--
-- The room test is copied verbatim from `paysrc` in finance_report. Keep them
-- identical: if they diverge, the ledger and the Sales block would disagree about
-- the same bill.
--
-- No balance changes. Body from the LIVE definition (pg_get_functiondef); only
-- the two columns, the sale branch's joins and eight null-pairs are new.
-- =============================================================

-- Return type changes, so it must be dropped rather than replaced.
drop function if exists finance_transactions(uuid, timestamptz, timestamptz);

create function finance_transactions(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(occurred_at timestamp with time zone, kind text, party text, method text, amount numeric, reference text, cash_delta numeric, online_delta numeric, credit_to_us_delta numeric, credit_by_us_delta numeric, cash_after numeric, online_after numeric, credit_to_us_after numeric, credit_by_us_after numeric, source text, source_label text)
 LANGUAGE sql
 STABLE
AS $function$
  with
  opening as (
    select opening_cash oc, opening_online oo,
           opening_credit_to_us otu, opening_credit_by_us obu
    from finance_report(p_restaurant_id, p_from, p_to)
  ),

  moves as (
    -- A bill. The tendered split is real money; the gap up to the bill total is
    -- credit raised against the customer — EXCEPT for anything already settled by
    -- a room deposit, which is money we took on an earlier day. Without the
    -- advance term here, a prepaid bill reads as a credit sale and the receivable
    -- climbs by a debt nobody owes.
    select
      p.created_at occurred_at,
      'sale'::text kind,
      (select cc.name from credits c
         join credit_customers cc on cc.id = c.customer_id
        where c.payment_id = p.id limit 1) party,
      case
        when coalesce(p.total_amount,p.amount) - (p.cash_amount + p.online_amount + coalesce(p.card_amount,0) + coalesce(p.advance_amount,0)) > 0.005
          then case when p.cash_amount + p.online_amount + coalesce(p.card_amount,0) + coalesce(p.advance_amount,0) > 0.005
                    then 'partial' else 'credit' end
        when coalesce(p.advance_amount,0) > 0.005
             and p.cash_amount + p.online_amount + coalesce(p.card_amount,0) <= 0.005 then 'advance'
        when p.cash_amount > 0.005 and p.online_amount + coalesce(p.card_amount,0) > 0.005 then 'mixed'
        when p.online_amount > 0.005 then 'online'
        when coalesce(p.card_amount,0) > 0.005 then 'card'
        else 'cash'
      end::text method,
      coalesce(p.total_amount,p.amount) amount,
      case when p.bill_number is not null then 'Bill #' || p.bill_number else null end::text reference,
      p.cash_amount cash_delta,
      (p.online_amount + coalesce(p.card_amount,0)) online_delta,
      (coalesce(p.total_amount,p.amount) - (p.cash_amount + p.online_amount + coalesce(p.card_amount,0) + coalesce(p.advance_amount,0))) credit_to_us_delta,
      0::numeric credit_by_us_delta,
      -- WHICH SIDE OF THE BUSINESS raised this bill, and which table or room.
      --
      -- The room test is IDENTICAL to `paysrc` in finance_report. If the two ever
      -- drift apart the ledger and the Sales block would classify the same bill
      -- differently — exactly the sort of quiet contradiction nobody reports until
      -- it has been wrong for a month. Three markers, because `room_id` survives a
      -- session transfer while a type set at creation might not.
      case
        when p.room_stay_id is not null or se.room_stay_id is not null
          or se.room_id is not null or se.type = 'room_service' then 'room'
        when se.walk_in_no is not null then 'walkin'
        when se.table_id is not null then 'table'
        else null
      end::text source,
      case
        when p.room_stay_id is not null or se.room_stay_id is not null
          or se.room_id is not null or se.type = 'room_service'
          then 'Room ' || coalesce(r.number, '—')
        when se.walk_in_no is not null then 'Walk-in ' || se.walk_in_no
        when se.table_id is not null then 'Table ' || coalesce(t.number, '—')
        else null
      end::text source_label
    from payments p
    left join sessions se on se.id = p.session_id
    -- The stay can hang off the PAYMENT or the SESSION, and the room can be
    -- reached through either; coalesce covers both. Every join is to a primary
    -- key, so none of them can multiply a payment into two ledger rows.
    left join room_stays rs on rs.id = coalesce(p.room_stay_id, se.room_stay_id)
    left join rooms r on r.id = coalesce(se.room_id, rs.room_id)
    left join restaurant_tables t on t.id = se.table_id
    where p.restaurant_id = p_restaurant_id
      and p.created_at >= p_from and p.created_at < p_to

    union all

    -- A room deposit taken, or (negative) returned. Real money, no sale, no credit
    -- leg — the sale books in full when the guest checks out. The signs mean one
    -- branch serves both directions.
    select
      a.created_at, 'room_advance',
      rs.guest_name,
      a.method::text,
      a.amount,
      'Room ' || coalesce(r.number, '—'),
      a.cash_amount,
      (a.online_amount + a.card_amount),
      0::numeric,
      0::numeric,
      null::text, null::text
    from room_advances a
    join room_stays rs on rs.id = a.stay_id
    left join rooms r on r.id = rs.room_id
    where a.restaurant_id = p_restaurant_id
      and a.created_at >= p_from and a.created_at < p_to

    union all

    -- Money received against an existing debt: cash in, receivable down. NOT new
    -- revenue — the bill was already counted when it was raised (accrual).
    select
      cp.created_at, 'credit_repayment',
      cc.name,
      case when cp.cash_amount > 0.005 and cp.online_amount > 0.005 then 'mixed' else cp.method::text end,
      cp.amount,
      cc.customer_code,
      cp.cash_amount,
      cp.online_amount,
      -cp.amount,
      0::numeric,
      null::text, null::text
    from credit_payments cp
    left join credit_customers cc on cc.id = cp.customer_id
    where cp.restaurant_id = p_restaurant_id
      and cp.created_at >= p_from and cp.created_at < p_to

    union all

    -- A supplier bill. Only the settled part leaves the till; the rest is a
    -- payable.
    select
      pu.created_at, 'purchase',
      v.name,
      pu.payment_method::text,
      pu.total_amount,
      pu.purchase_code,
      -pu.cash_amount,
      -pu.online_amount,
      0::numeric,
      pu.credit_amount,
      null::text, null::text
    from purchases pu
    left join vendors v on v.id = pu.vendor_id
    where pu.restaurant_id = p_restaurant_id
      and pu.created_at >= p_from and pu.created_at < p_to

    union all

    -- Paying a supplier down: money out AND the payable falls.
    select
      vp.created_at, 'vendor_payment',
      v.name,
      case when vp.cash_amount > 0.005 and vp.online_amount > 0.005 then 'mixed' else vp.method::text end,
      vp.amount,
      v.vendor_code,
      -vp.cash_amount,
      -vp.online_amount,
      0::numeric,
      -vp.amount,
      null::text, null::text
    from vendor_payments vp
    left join vendors v on v.id = vp.vendor_id
    where vp.restaurant_id = p_restaurant_id
      and vp.created_at >= p_from and vp.created_at < p_to

    union all

    -- Wages. Money out, no credit leg — payroll's own liability is reported
    -- separately and is not a vendor-style payable.
    select
      sp.created_at,
      case when sp.kind = 'advance' then 'salary_advance' else 'salary' end,
      ru.display_name,
      case when sp.cash_amount > 0.005 and sp.online_amount > 0.005 then 'mixed' else sp.method::text end,
      sp.amount,
      to_char(sp.salary_month, 'Mon YYYY'),
      -sp.cash_amount,
      -sp.online_amount,
      0::numeric,
      0::numeric,
      null::text, null::text
    from salary_payments sp
    left join restaurant_users ru on ru.id = sp.restaurant_user_id
    where sp.restaurant_id = p_restaurant_id
      and sp.created_at >= p_from and sp.created_at < p_to

    union all

    -- An overhead. `party` carries the category so the ledger reads "Electricity"
    -- where a purchase would read the vendor's name; the note becomes the
    -- reference, which is where a bill number or purchase code sits on other
    -- rows. `initcap` matches the labels in lib/expenses.ts by construction —
    -- the category keys are deliberately single words so the two cannot drift.
    select
      e.created_at,
      'extra_expense',
      initcap(e.category),
      e.payment_method::text,
      e.amount,
      nullif(e.note, ''),
      -e.cash_amount,
      -e.online_amount,
      0::numeric,
      0::numeric,
      null::text, null::text
    from extra_expenses e
    where e.restaurant_id = p_restaurant_id
      and e.created_at >= p_from and e.created_at < p_to

    union all

    -- An account OPENED during the period carrying a balance from paper books.
    -- No money moves, but the debt is real from that moment and it lands in the
    -- closing balance — so without these two branches the running total falls
    -- short by exactly the carried amount.
    select
      v.created_at, 'vendor_opening',
      v.name, 'credit'::text, v.opening_credit, v.vendor_code,
      0::numeric, 0::numeric, 0::numeric, v.opening_credit,
      null::text, null::text
    from vendors v
    where v.restaurant_id = p_restaurant_id
      and v.opening_credit > 0
      and v.created_at >= p_from and v.created_at < p_to

    union all

    select
      cc.created_at, 'customer_opening',
      cc.name, 'credit'::text, cc.opening_balance, cc.customer_code,
      0::numeric, 0::numeric, cc.opening_balance, 0::numeric,
      null::text, null::text
    from credit_customers cc
    where cc.restaurant_id = p_restaurant_id
      and cc.opening_balance > 0
      and cc.created_at >= p_from and cc.created_at < p_to
  )

  select
    m.occurred_at, m.kind, m.party, m.method, m.amount, m.reference,
    m.cash_delta, m.online_delta, m.credit_to_us_delta, m.credit_by_us_delta,
    ((select oc  from opening) + sum(m.cash_delta)         over w)::numeric,
    ((select oo  from opening) + sum(m.online_delta)       over w)::numeric,
    ((select otu from opening) + sum(m.credit_to_us_delta) over w)::numeric,
    ((select obu from opening) + sum(m.credit_by_us_delta) over w)::numeric,
    m.source, m.source_label
  from moves m
  -- `occurred_at` alone is not a total order — two movements can share an
  -- instant — so the running balance would be non-deterministic without a
  -- tie-break. Ordering the frame by (time, kind, reference) makes every read
  -- of the same period produce the same ledger.
  window w as (order by m.occurred_at, m.kind, m.reference
               rows between unbounded preceding and current row)
  order by m.occurred_at desc, m.kind, m.reference;
$function$;

notify pgrst, 'reload schema';
