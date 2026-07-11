"use client";

import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  addCreditPayment,
  getCreditDetail,
  getCredits,
  getCreditSummary,
} from "@/app/actions/credits";
import type {
  ActionResult,
  CreditDetail,
  CreditFilter,
  CreditListItem,
} from "@/app/actions/credits";
import type { CreditStats } from "@/lib/credits";
import { CREDIT_STATUS_COLOR, CREDIT_STATUS_LABEL } from "@/lib/credits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CreditReceiptButton } from "./credit-receipt";
import { Loader2, Search, X } from "lucide-react";

function money(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}
function money2(n: number) {
  return `₹${n.toFixed(2)}`;
}

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  online: "Online",
  card: "Card",
  mixed: "Mixed",
  credit: "Credit",
  upi: "UPI",
  other: "Other",
};

const FILTERS: { key: CreditFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "partially_paid", label: "Partially Paid" },
  { key: "fully_paid", label: "Fully Paid" },
];

const REPAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "online", label: "Online" },
  { value: "card", label: "Card" },
];

function StatTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div
      className="rounded-xl border px-4 py-3"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <p className="text-xs mb-1" style={{ color: "var(--color-ink-mute)" }}>{label}</p>
      <p className="text-lg font-medium tabular-nums" style={{ color: tone ?? "var(--color-ink)" }}>
        {value}
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: CreditListItem["status"] }) {
  const color = CREDIT_STATUS_COLOR[status];
  return (
    <span
      className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0"
      style={{ color, borderColor: `${color}44`, background: `${color}11`, letterSpacing: "0.06em" }}
    >
      {CREDIT_STATUS_LABEL[status]}
    </span>
  );
}

function CreditCard({ credit, onOpen }: { credit: CreditListItem; onOpen: () => void }) {
  const settled = credit.status === "fully_paid";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-xl border px-4 py-3 text-left transition-colors"
      style={{
        background: "var(--color-canvas)",
        borderColor: "var(--color-hairline)",
        opacity: settled ? 0.7 : 1,
      }}
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>
              {credit.customer_name}
            </p>
            <StatusPill status={credit.status} />
          </div>
          <p className="text-xs mt-0.5 truncate" style={{ color: "var(--color-ink-mute)" }}>
            {credit.credit_number}
            {credit.customer_phone ? ` · ${credit.customer_phone}` : ""}
            {" · "}
            {credit.location}
            {" · "}
            {new Date(credit.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p
            className="text-sm font-medium tabular-nums"
            style={{ color: settled ? "var(--color-ink-mute)" : CREDIT_STATUS_COLOR[credit.status] }}
          >
            {money(credit.balance)}
          </p>
          <p className="text-[10px]" style={{ color: "var(--color-ink-mute)" }}>
            {settled ? "settled" : `of ${money(credit.bill_amount)}`}
          </p>
        </div>
      </div>
    </button>
  );
}

// ── Detail: full history + record a repayment ─────────────────────────────────

function CreditDetailModal({
  creditId,
  onClose,
  onChanged,
}: {
  creditId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<CreditDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [state, action, pending] = useActionState<ActionResult, FormData>(addCreditPayment, null);

  const load = useCallback(async () => {
    const res = await getCreditDetail(creditId);
    if ("error" in res) setLoadError(res.error);
    else setDetail(res);
  }, [creditId]);

  useEffect(() => { load(); }, [load]);

  // `addCreditPayment` returns null both before the first submit and after a
  // successful one, so success can't be read from `state` alone — watch the
  // falling edge of `pending` instead. On success reload the credit (balance,
  // status, history all moved) and refresh the list behind the modal.
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) {
      setAmount("");
      load();
      onChanged();
    }
    wasPending.current = pending;
  }, [pending, state, load, onChanged]);

  const balance = detail?.balance ?? 0;
  const settled = detail?.status === "fully_paid";
  const amountNum = parseFloat(amount) || 0;
  const amountValid = amountNum > 0 && amountNum <= balance + 0.005;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start sm:items-center justify-center overflow-y-auto"
      style={{ background: "rgba(13,37,61,0.45)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md my-6 mx-3 rounded-2xl overflow-hidden"
        style={{ background: "var(--color-canvas)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: "var(--color-hairline)" }}
        >
          <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
            {detail ? `${detail.credit_number} · ${detail.customer_name}` : "Credit"}
          </p>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-4 max-h-[75vh] overflow-y-auto flex flex-col gap-4">
          {loadError && (
            <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--color-ruby)", background: "#fff0f4" }}>
              {loadError}
            </p>
          )}

          {!detail && !loadError && (
            <div className="flex items-center justify-center py-8" style={{ color: "var(--color-ink-mute)" }}>
              <Loader2 size={18} className="animate-spin" />
            </div>
          )}

          {detail && (
            <>
              {/* Balance summary */}
              <div
                className="rounded-xl border px-4 py-3 flex flex-col gap-1.5"
                style={{
                  background: settled ? "#f0fdf4" : "#fff7ed",
                  borderColor: settled ? "#1a7a4a44" : "#f9731644",
                }}
              >
                <div className="flex items-center justify-between text-sm">
                  <span style={{ color: "var(--color-ink-mute)" }}>Original bill</span>
                  <span className="tabular-nums" style={{ color: "var(--color-ink)" }}>
                    {money2(detail.bill_amount)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span style={{ color: "var(--color-ink-mute)" }}>Paid so far</span>
                  <span className="tabular-nums" style={{ color: "var(--color-ink)" }}>
                    − {money2(detail.paid_amount)}
                  </span>
                </div>
                <div
                  className="flex items-center justify-between pt-1.5 border-t"
                  style={{ borderColor: settled ? "#1a7a4a22" : "#f9731633" }}
                >
                  <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                    {settled ? "Settled" : "Balance due"}
                  </span>
                  <span
                    className="text-lg font-medium tabular-nums"
                    style={{ color: settled ? "#1a7a4a" : "#9a3412" }}
                  >
                    {money2(detail.balance)}
                  </span>
                </div>
              </div>

              {/* Meta */}
              <div className="flex flex-col gap-1 text-xs" style={{ color: "var(--color-ink-mute)" }}>
                <div className="flex justify-between gap-3">
                  <span>Opened</span>
                  <span style={{ color: "var(--color-ink)" }}>
                    {new Date(detail.created_at).toLocaleString("en-IN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                </div>
                {detail.customer_phone && (
                  <div className="flex justify-between gap-3">
                    <span>Phone</span>
                    <a href={`tel:${detail.customer_phone}`} style={{ color: "var(--color-primary)" }}>
                      {detail.customer_phone}
                    </a>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <span>Bill</span>
                  <span style={{ color: "var(--color-ink)" }}>{detail.location}</span>
                </div>
                {detail.created_by_name && (
                  <div className="flex justify-between gap-3">
                    <span>Billed by</span>
                    <span style={{ color: "var(--color-ink)" }}>{detail.created_by_name}</span>
                  </div>
                )}
                {detail.notes && (
                  <div className="flex justify-between gap-3">
                    <span>Note</span>
                    <span className="text-right" style={{ color: "var(--color-ink)" }}>{detail.notes}</span>
                  </div>
                )}
              </div>

              {/* Record a payment — hidden once there's nothing left to collect. */}
              {!settled && (
                <form
                  action={action}
                  className="rounded-xl border px-4 py-4 flex flex-col gap-3"
                  style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-hairline)" }}
                >
                  <input type="hidden" name="credit_id" value={detail.id} />
                  <input type="hidden" name="method" value={method} />

                  <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                    Record a payment
                  </p>

                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="credit_pay_amount"
                      className="text-xs uppercase tracking-wide"
                      style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
                    >
                      Amount received (₹)
                    </label>
                    <div className="relative">
                      <span
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none"
                        style={{ color: "var(--color-ink-mute)" }}
                      >
                        ₹
                      </span>
                      <Input
                        id="credit_pay_amount"
                        name="amount"
                        type="number"
                        min="0.01"
                        max={detail.balance}
                        step="0.01"
                        required
                        placeholder="0.00"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="pl-7"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setAmount(detail.balance.toFixed(2))}
                      className="self-start text-xs underline"
                      style={{ color: "var(--color-primary)" }}
                    >
                      Settle in full ({money2(detail.balance)})
                    </button>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <p
                      className="text-xs uppercase tracking-wide"
                      style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
                    >
                      Received as
                    </p>
                    <div className="grid grid-cols-3 gap-1">
                      {REPAYMENT_METHODS.map((m) => {
                        const active = method === m.value;
                        return (
                          <button
                            key={m.value}
                            type="button"
                            onClick={() => setMethod(m.value)}
                            className="py-1.5 rounded-lg border text-sm transition-colors"
                            style={{
                              borderColor: active ? "var(--color-primary)" : "var(--color-hairline-input)",
                              background: active ? "rgba(99,102,241,0.06)" : "var(--color-canvas)",
                              color: "var(--color-ink)",
                            }}
                          >
                            {m.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <Input name="notes" type="text" placeholder="Note (optional)" autoComplete="off" />

                  {amount !== "" && !amountValid && (
                    <p className="text-xs" style={{ color: "var(--color-ruby)" }}>
                      {amountNum > balance
                        ? `That's more than the ${money2(balance)} still owed.`
                        : "Enter an amount greater than zero."}
                    </p>
                  )}

                  {state?.error && (
                    <p
                      className="text-sm rounded-md px-3 py-2"
                      style={{ color: "var(--color-ruby)", background: "#fff0f4" }}
                    >
                      {state.error}
                    </p>
                  )}

                  <Button type="submit" variant="primary" disabled={pending || !amountValid}>
                    {pending ? "Recording…" : `Record ${amountNum > 0 ? money2(amountNum) : "payment"}`}
                  </Button>
                </form>
              )}

              {/* Payment history */}
              <div>
                <p
                  className="text-xs uppercase tracking-wide mb-2 font-medium"
                  style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
                >
                  Payment history
                </p>
                {detail.history.length === 0 ? (
                  <div
                    className="rounded-xl border px-4 py-6 text-center"
                    style={{ borderStyle: "dashed", borderColor: "var(--color-hairline)" }}
                  >
                    <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
                      Nothing paid yet — the full bill is outstanding.
                    </p>
                  </div>
                ) : (
                  <div
                    className="rounded-xl border overflow-hidden"
                    style={{ borderColor: "var(--color-hairline)" }}
                  >
                    {detail.history.map((h, i) => (
                      <div
                        key={h.id}
                        className="flex items-start gap-3 px-4 py-2.5"
                        style={{
                          borderTop: i === 0 ? "none" : "1px solid var(--color-hairline)",
                          background: "var(--color-canvas)",
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm" style={{ color: "var(--color-ink)" }}>
                            {METHOD_LABEL[h.method] ?? h.method}
                            {h.at_billing && (
                              <span className="ml-1.5 text-xs" style={{ color: "var(--color-ink-mute)" }}>
                                at billing
                              </span>
                            )}
                          </p>
                          <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                            {new Date(h.created_at).toLocaleString("en-IN", {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                            {h.staff_name ? ` · ${h.staff_name}` : ""}
                          </p>
                          {h.notes && (
                            <p className="text-xs italic mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
                              {h.notes}
                            </p>
                          )}
                        </div>
                        <p
                          className="text-sm font-medium tabular-nums shrink-0"
                          style={{ color: "#1a7a4a" }}
                        >
                          {money2(h.amount)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <CreditReceiptButton creditId={detail.id} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export function CreditsView({
  initialCredits,
  initialSummary,
  initialOpenId = null,
  embedded = false,
}: {
  initialCredits: CreditListItem[];
  initialSummary: CreditStats;
  initialOpenId?: string | null;
  embedded?: boolean;
}) {
  const [credits, setCredits] = useState(initialCredits);
  const [summary, setSummary] = useState(initialSummary);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<CreditFilter>("all");
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [loading, startTransition] = useTransition();

  const reload = useCallback((s: string, st: CreditFilter) => {
    startTransition(async () => {
      try {
        const [rows, sum] = await Promise.all([
          getCredits({ search: s, status: st }),
          getCreditSummary(),
        ]);
        setCredits(rows);
        setSummary(sum);
      } catch {
        // keep the last known list on a transient failure
      }
    });
  }, []);

  // Debounced search / filter. Skips the very first run — the server already
  // rendered the unfiltered list.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const t = setTimeout(() => reload(search, status), 250);
    return () => clearTimeout(t);
  }, [search, status, reload]);

  const refresh = useCallback(() => reload(search, status), [reload, search, status]);

  return (
    <div className={embedded ? "" : "p-4 sm:p-5 max-w-2xl mx-auto"}>
      {!embedded && (
        <h1
          className="text-xl mb-1"
          style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}
        >
          Credits
        </h1>
      )}
      <p className="text-sm mb-5" style={{ color: "var(--color-ink-mute)" }}>
        {summary.openCount === 0
          ? "No open credits — everything is settled."
          : `${summary.openCount} open credit${summary.openCount !== 1 ? "s" : ""} · ${money(summary.outstanding)} outstanding`}
        {loading && <span className="ml-2">Updating…</span>}
      </p>

      {/* Stat tiles */}
      <div
        className="grid gap-3 mb-4"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}
      >
        <StatTile
          label="Outstanding"
          value={money(summary.outstanding)}
          tone={summary.outstanding > 0 ? "#dc2626" : undefined}
        />
        <StatTile label="Collected today" value={money(summary.collected)} tone="#1a7a4a" />
        <StatTile label="Pending" value={String(summary.pendingCount)} />
        <StatTile label="Partially paid" value={String(summary.partiallyPaidCount)} />
        <StatTile label="Fully paid" value={String(summary.fullyPaidCount)} />
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search
          size={15}
          className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: "var(--color-ink-mute)" }}
        />
        <Input
          type="search"
          placeholder="Search by credit ID, name or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Status filter */}
      <div className="flex gap-2 overflow-x-auto mb-4" style={{ scrollbarWidth: "none" }}>
        {FILTERS.map((f) => {
          const active = status === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatus(f.key)}
              className="shrink-0 text-sm px-3 py-1.5 rounded-full border transition-colors"
              style={{
                borderColor: active ? "var(--color-primary)" : "var(--color-hairline)",
                background: active ? "var(--color-primary)" : "var(--color-canvas)",
                color: active ? "#fff" : "var(--color-ink)",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* List */}
      {credits.length === 0 ? (
        <div
          className="rounded-xl border px-6 py-12 text-center"
          style={{ borderStyle: "dashed", borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
        >
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            {search || status !== "all"
              ? "No credits match that search."
              : "No credits yet. Choose Credit when closing a bill to record one."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {credits.map((c) => (
            <CreditCard key={c.id} credit={c} onOpen={() => setOpenId(c.id)} />
          ))}
        </div>
      )}

      {openId && (
        <CreditDetailModal
          creditId={openId}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
