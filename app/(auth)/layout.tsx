export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{
        background: "linear-gradient(135deg, #0f0d07 0%, #1a1508 50%, #100c06 100%)",
      }}
    >
      {children}
    </div>
  );
}
