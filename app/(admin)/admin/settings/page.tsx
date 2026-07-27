import { requireRestaurantAdmin } from "@/lib/auth/guards";
import {
  getBillingSettings,
  getBusinessDaySettings,
  getDailySummarySettings,
  getWorkstationNumbering,
} from "@/app/actions/settings";
import { SettingsClient } from "./_components/settings-client";
import { WorkstationNumberingClient } from "./_components/workstation-numbering-client";
import { DiscountPinClient } from "./_components/discount-pin-client";
import { BusinessDayClient } from "./_components/business-day-client";
import { DailySummaryClient } from "./_components/daily-summary-client";

export default async function SettingsPage() {
  // Billing settings are the owner's call — staff (even with permissions) don't set them.
  await requireRestaurantAdmin();
  const [settings, workstations, businessDay, dailySummary] = await Promise.all([
    getBillingSettings(),
    getWorkstationNumbering(),
    getBusinessDaySettings(),
    getDailySummarySettings(),
  ]);

  return (
    <div className="p-4 md:p-8">
      <h1
        className="text-2xl mb-1"
        style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}
      >
        Settings
      </h1>
      <p className="text-sm mb-8" style={{ color: "var(--color-ink-mute)" }}>
        When your business day ends, billing details that print on every bill — your PAN number,
        how bills are numbered, each workstation&apos;s ticket numbering, and who may discount a
        bill.
      </p>

      <div className="flex flex-col gap-8">
        {/* First: it decides what every date on every other screen means. */}
        <BusinessDayClient closingHour={businessDay.closingHour} />
        <SettingsClient settings={settings} />
        <DiscountPinClient pinSet={settings.discountPinSet} />
        <DailySummaryClient config={dailySummary} />
        <WorkstationNumberingClient workstations={workstations} />
      </div>
    </div>
  );
}
