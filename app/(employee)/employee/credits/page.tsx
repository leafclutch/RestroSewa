import { redirect } from "next/navigation";

// Customer credits are a section of the dashboard now. Kept as a redirect so an old
// link lands on the dashboard scrolled to Credits rather than on a duplicate page.
//
// The deep link to one account (?open=<customerId>) maps onto the dashboard's own
// ?credit=<id>, which opens that customer's account inside the Credits section — the
// same landing a bill closed on credit already uses. The dashboard renders Credits
// only for staff with billing + close-bills permission, so no separate guard here.
export default async function CreditsPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>;
}) {
  const { open } = await searchParams;
  redirect(open ? `/employee/dashboard?credit=${open}` : "/employee/dashboard?focus=credits");
}
