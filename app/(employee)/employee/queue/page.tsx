import { redirect } from "next/navigation";

// The order queue is a section of the dashboard now (Orders, always first). This
// route is kept only as a redirect so a tapped "new order" push, an app shortcut or
// an old bookmark lands on the dashboard scrolled to Orders rather than on a
// duplicate page.
export default function OrdersQueuePage() {
  redirect("/employee/dashboard?focus=orders");
}
