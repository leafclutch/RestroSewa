export default function CustomerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="customer-theme min-h-screen bg-background text-foreground">
      {children}
    </div>
  )
}
