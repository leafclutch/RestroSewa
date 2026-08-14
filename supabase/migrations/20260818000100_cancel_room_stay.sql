-- Cancelling a checked-in stay, and settling the deposit.
--
-- Until now a stay could only end through `check_out_room`, which bills the
-- folio and takes payment. There was no way to say "this guest is not staying
-- after all": the desk had to check the guest out for a bill they never ran up,
-- or leave the stay open — and either way the room stayed occupied, because
-- `room_stays_one_active_per_room` blocks the next check-in.
--
-- ── WHERE THE KEPT MONEY GOES, WHICH IS THE WHOLE DESIGN ─────────────────────
-- A ₹5,000 deposit already raised cash-in-hand by ₹5,000 on the day it was
-- taken, and raised `advances_held` — the fifth balance, guests' money sitting
-- in the till — by the same. Refund ₹3,000 and the hotel keeps ₹2,000.
--
-- If that ₹2,000 is not recognised as income it stays booked as a deposit
-- against a stay that no longer exists, and `advances_held` NEVER returns to
-- zero. The fifth balance drifts permanently and nothing fails loudly enough to
-- notice — the balances still reconcile, they are just reconciling to a lie.
--
-- So a retained deposit is a SALE: one `payments` row with
--   total_amount = amount = advance_amount = the retained figure
--   cash = online = card = 0
-- No new money moves (it is already in the till); the sale is recognised and
-- `advances_held` clears. This is not a new mechanism — it is exactly what
-- `payments.advance_amount` already does for a prepaid checkout.
--
-- ⚠️ It also keeps the credit invariant intact:
--   left on credit = total − (cash + online + card + advance_amount) = 0
-- Drop the advance_amount term and every cancellation would open a credit
-- account for a guest who owes nothing. That is the phantom-debt regression
-- 20260811000000 was written to prevent; the same trap applies here.
--
-- NO finance function changes. `finance_report` and `finance_transactions`
-- already read `payments` and `room_advances`, and a cancellation writes only
-- those two. That pair must always move together — here neither has to move.

alter table room_stays
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references restaurant_users(id) on delete set null,
  -- What the hotel kept out of the deposit. Zero for a full refund, and zero for
  -- a stay that never had a deposit at all.
  add column if not exists cancellation_charge numeric(12,2) not null default 0,
  add column if not exists cancellation_reason text;

alter table room_stays drop constraint if exists room_stays_cancellation_charge_check;
alter table room_stays add constraint room_stays_cancellation_charge_check
  check (cancellation_charge >= 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- cancel_room_stay
--
-- Deliberately shaped like `check_out_room`, because it has to AGREE with it:
-- the held-advance read, the refund identity and the room hand-off are the same
-- three moves. Where the two differ, they differ on purpose and it is commented.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.cancel_room_stay(
  p_restaurant_id uuid,
  p_stay_id       uuid,
  p_charge        numeric,
  p_refund_cash   numeric,
  p_refund_online numeric,
  p_reason        text,
  p_created_by    uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_stay    room_stays;
  v_session sessions;
  v_held    numeric;
  v_charge  numeric := coalesce(p_charge, 0);
  v_refund  numeric := coalesce(p_refund_cash, 0) + coalesce(p_refund_online, 0);
  v_now     timestamptz := now();
begin
  -- `for update` serialises a cancellation against a simultaneous checkout.
  select * into v_stay
    from room_stays
   where id = p_stay_id and restaurant_id = p_restaurant_id
   for update;
  if not found then
    raise exception 'STAY_NOT_FOUND';
  end if;
  if v_stay.status <> 'active' then
    raise exception 'STAY_NOT_ACTIVE';
  end if;

  -- Read INSIDE the transaction, never taken from the client — the same
  -- principle check_out_room applies to the total: the browser says what it
  -- thinks is held, we look.
  select coalesce(sum(amount), 0) into v_held
    from room_advances
   where stay_id = p_stay_id;

  if v_charge < 0 or v_charge > v_held + 0.005 then
    raise exception 'INVALID_CHARGE';
  end if;

  -- Every paisa of the deposit is accounted for: kept, or handed back. Identical
  -- in form to check_out_room's refund check, so the two cannot come to disagree
  -- about what a refund is.
  if abs(v_refund - (v_held - v_charge)) > 0.005 then
    raise exception 'REFUND_MISMATCH';
  end if;

  select * into v_session
    from sessions
   where room_stay_id = p_stay_id
   order by opened_at
   limit 1
   for update;

  -- The refund goes in BEFORE the stay is closed: record_room_advance refuses to
  -- write against a settled stay, and rightly so.
  if v_refund > 0.005 then
    perform record_room_advance(
      p_restaurant_id => p_restaurant_id,
      p_stay_id       => p_stay_id,
      p_amount        => -v_refund,
      p_cash          => -coalesce(p_refund_cash, 0),
      p_online        => -coalesce(p_refund_online, 0),
      -- No card refund: a swipe cannot be reversed at the desk. Same rule as
      -- check_out_room.
      p_card          => 0,
      p_method        => case
                           when coalesce(p_refund_cash,0) > 0.005 and coalesce(p_refund_online,0) > 0.005 then 'mixed'
                           when coalesce(p_refund_online,0) > 0.005 then 'online'
                           else 'cash'
                         end,
      p_note          => 'Refund of deposit on cancellation',
      p_created_by    => p_created_by
    );
  end if;

  -- Close the stay BEFORE the payment. `check_out_at` is an input to the folio,
  -- so writing it first is what stops the bill moving underneath the amount we
  -- are about to charge — the same ordering check_out_room documents.
  update room_stays
     set status              = 'cancelled',
         check_out_at        = v_now,
         cancelled_at        = v_now,
         cancelled_by        = p_created_by,
         cancellation_charge = v_charge,
         cancellation_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_stay_id;

  -- The sale, only if something was kept. A full refund earns nothing, so it
  -- writes no payment row at all rather than a zero-value sale that would show
  -- up in Sales as a bill for nothing.
  if v_charge > 0.005 then
    if v_session.id is null then
      raise exception 'NO_SESSION_FOR_STAY';
    end if;

    insert into payments (
      restaurant_id, session_id, amount,
      cash_amount, online_amount, card_amount, advance_amount, total_amount,
      payment_method, created_by
    ) values (
      p_restaurant_id, v_session.id, v_charge,
      -- Nothing changes hands now: the money arrived when the deposit was taken.
      -- advance_amount carries the whole sale, which is what leaves zero on
      -- credit and keeps a cancellation out of the receivables.
      0, 0, 0, v_charge, v_charge,
      'cash'::payment_method, p_created_by
    );
  end if;

  if v_session.id is not null and v_session.status <> 'closed' then
    update sessions set status = 'closed', closed_at = v_now where id = v_session.id;
  end if;

  -- Cleaning, exactly as a checkout: a room that was occupied even briefly
  -- usually needs making up, and `markRoomClean` already turns it over.
  update rooms set status = 'cleaning' where id = v_stay.room_id;

  return jsonb_build_object(
    'stay_id',    p_stay_id,
    'session_id', v_session.id,
    'held',       v_held,
    'charge',     v_charge,
    'refund',     v_refund
  );
end;
$$;

grant execute on function public.cancel_room_stay(uuid, uuid, numeric, numeric, numeric, text, uuid)
  to service_role;
