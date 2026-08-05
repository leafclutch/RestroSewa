// How a payment method is spelled on a BILL.
//
// Shared by the two places that print a settled bill — the Sales reprint and the room
// folio — because those two must read identically for the same payment. Other screens
// keep their own maps: a sales list or a finance report labels methods it never prints
// (`partial`, purchase-only methods), so folding them all into one map would mean one
// screen's vocabulary leaking onto a customer's receipt.
export const BILL_METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  online: "Online",
  mixed: "Cash + Online",
  card: "Card",
  credit: "Credit",
  upi: "UPI",
  other: "Other",
};

/** The label for a method, falling back to the raw value for anything unmapped. */
export const billMethodLabel = (method: string) => BILL_METHOD_LABEL[method] ?? method;
