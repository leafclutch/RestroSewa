export default async function CustomerTablePage({
  params,
}: {
  params: Promise<{ qr_token: string }>
}) {
  const { qr_token } = await params

  return (
    <main className="min-h-screen p-4">
      <h1 className="font-serif text-2xl font-semibold text-foreground">
        Welcome
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Table token: {qr_token}
      </p>
      <p className="mt-4 text-xs text-muted-foreground">[Customer menu — stub]</p>
    </main>
  )
}
