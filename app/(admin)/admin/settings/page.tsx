import { requireRestaurantAdmin } from "@/lib/auth/guards";
import { getBillingSettings, getWorkstationNumbering } from "@/app/actions/settings";
import { SettingsClient } from "./_components/settings-client";
import { WorkstationNumberingClient } from "./_components/workstation-numbering-client";
import { DiscountPinClient } from "./_components/discount-pin-client";

export default async function SettingsPage() {
  // Billing settings are the owner's call — staff (even with permissions) don't set them.
  await requireRestaurantAdmin();
  const [settings, workstations] = await Promise.all([
    getBillingSettings(),
    getWorkstationNumbering(),
  ]);

  return (
    <div className="p-4 md:p-8">
      <h1
        className="text-xl mb-1"
        style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}
      >
        Settings
      </h1>
      <p className="text-sm mb-8" style={{ color: "var(--color-ink-mute)" }}>
        Billing details that print on every bill — your PAN number, how bills are numbered, each
        workstation&apos;s ticket numbering, and who may discount a bill.
      </p>

      <div className="flex flex-col gap-8">
        <SettingsClient settings={settings} />
        <DiscountPinClient pinSet={settings.discountPinSet} />
        <WorkstationNumberingClient workstations={workstations} />
      </div>
    </div>
  );
}
