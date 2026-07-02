"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormErrorMessage } from "@/components/form-error-message";

type ProductStatusButtonProps = {
  workspaceId: string;
  productId: string;
  productName: string;
  active: boolean;
};

export function ProductStatusButton({ workspaceId, productId, productName, active }: ProductStatusButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const action = active ? "deactivate" : "activate";
  const actionLabel = active ? `Deactivate product ${productName}` : `Reactivate product ${productName}`;

  async function onClick() {
    setError(null);
    setIsSaving(true);

    const response = await fetch(`/api/v1/workspaces/${workspaceId}/products/${productId}/${action}`, {
      method: "POST"
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "Could not update product status.");
      setIsSaving(false);
      return;
    }

    setIsSaving(false);
    router.refresh();
  }

  return (
    <div className="inline-form">
      {error ? <FormErrorMessage compact>{error}</FormErrorMessage> : null}
      <button
        aria-label={actionLabel}
        className="button-secondary button-compact"
        disabled={isSaving}
        onClick={onClick}
        title={actionLabel}
        type="button"
      >
        {isSaving ? "Saving..." : active ? "Deactivate" : "Reactivate"}
      </button>
    </div>
  );
}
