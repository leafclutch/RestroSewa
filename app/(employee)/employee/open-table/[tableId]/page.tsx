import { openTableSession } from "@/app/actions/pos";

export default async function OpenTablePage({
  params,
}: {
  params: Promise<{ tableId: string }>;
}) {
  const { tableId } = await params;
  await openTableSession(tableId);
  return null;
}
