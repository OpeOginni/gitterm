"use client";

import { BillingSection } from "@/components/dashboard/billing-section";
import { DeleteAccountSection } from "@/components/dashboard/delete-account";

interface AccountSectionProps {
  currentPlan: "free" | "pro";
}

export function AccountSection({ currentPlan }: AccountSectionProps) {
  return (
    <div className="space-y-6">
      <BillingSection currentPlan={currentPlan} />
      <DeleteAccountSection />
    </div>
  );
}
