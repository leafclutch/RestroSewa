import { Skeleton } from "@/components/ui/skeleton";

// The Staff page's shape while its server render (roster + payroll sheet) is on
// its way: heading, roster cards, payroll summary tiles, one card per person.
export default function StaffLoading() {
  const card = { background: "var(--color-canvas)", borderColor: "var(--color-hairline)" };
  return (
    <div className="p-4 md:p-8 w-full" aria-busy>
      <Skeleton w={120} h={26} className="mb-2" />
      <Skeleton w={260} h={13} className="mb-8" />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 mb-10">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl border shadow-sm" style={card}>
            <Skeleton w={32} h={32} className="rounded-full shrink-0" />
            <div className="flex flex-col gap-1.5 flex-1">
              <Skeleton w="50%" h={13} />
              <Skeleton w="30%" h={11} />
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="flex flex-col gap-1.5">
          <Skeleton w={110} h={20} />
          <Skeleton w={280} h={12} />
        </div>
        <Skeleton w={240} h={42} className="rounded-xl" />
      </div>

      <div
        className="grid gap-3 mb-6"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}
      >
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border px-4 py-3 flex flex-col gap-2" style={card}>
            <Skeleton w="50%" h={11} />
            <Skeleton w="70%" h={22} />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-xl border shadow-sm px-4 py-3.5 flex flex-col lg:flex-row lg:items-center gap-3"
            style={card}
          >
            <div className="flex items-center gap-2.5 flex-1">
              <Skeleton w={36} h={36} className="rounded-full shrink-0" />
              <div className="flex flex-col gap-1.5 flex-1">
                <Skeleton w="40%" h={14} />
                <Skeleton w="25%" h={11} />
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 lg:w-[380px]">
              {[0, 1, 2, 3].map((j) => (
                <div key={j} className="flex flex-col gap-1">
                  <Skeleton w={44} h={9} />
                  <Skeleton w={64} h={14} />
                </div>
              ))}
            </div>
            <Skeleton w={150} h={32} />
          </div>
        ))}
      </div>
    </div>
  );
}
