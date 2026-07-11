"use client";

import { useState } from "react";
import { getCreditReceipt } from "@/app/actions/credits";
import type { CreditReceipt } from "@/app/actions/credits";
import { PrintModal, CreditReceiptTicket } from "@/app/(employee)/employee/_components/bill-ticket";
import { Button } from "@/components/ui/button";
import { Printer, Loader2 } from "lucide-react";

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  online: "Online",
  card: "Card",
  mixed: "Mixed",
  upi: "UPI",
  other: "Other",
};

// Prints the credit record — what was owed, what's been paid against it and the
// balance as of now. Reassembled from the existing credit + ledger; creates nothing.
export function CreditReceiptButton({ creditId }: { creditId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [receipt, setReceipt] = useState<CreditReceipt | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await getCreditReceipt(creditId);
      if ("error" in res) {
        alert(res.error);
        return;
      }
      setReceipt(res);
      setOpen(true);
    } catch {
      alert("Could not load the receipt. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={load}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
        Print credit receipt
      </Button>

      {receipt && (
        <PrintModal open={open} onClose={() => setOpen(false)} title="Credit receipt — preview">
          <CreditReceiptTicket
            restaurant={receipt.restaurant}
            creditNumber={receipt.credit.credit_number}
            customerName={receipt.credit.customer_name}
            customerPhone={receipt.credit.customer_phone}
            openedAt={new Date(receipt.credit.created_at)}
            location={receipt.credit.location}
            billAmount={receipt.credit.bill_amount}
            paidAmount={receipt.credit.paid_amount}
            balance={receipt.credit.balance}
            notes={receipt.credit.notes}
            history={receipt.credit.history.map((h) => ({
              id: h.id,
              amount: h.amount,
              method: METHOD_LABEL[h.method] ?? h.method,
              staff_name: h.staff_name,
              created_at: h.created_at,
              at_billing: h.at_billing,
            }))}
          />
        </PrintModal>
      )}
    </>
  );
}
