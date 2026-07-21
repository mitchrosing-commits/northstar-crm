"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormErrorMessage } from "@/components/form-error-message";
import { FormSuccessMessage } from "@/components/form-success-message";

type ProductStatusButtonProps = {
  workspaceId: string;
  productId: string;
  productName: string;
  active: boolean;
};

export function ProductStatusButton({ workspaceId, productId, productName, active }: ProductStatusButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const action = active ? "deactivate" : "activate";
  const actionLabel = active ? `Deactivate product ${productName}` : `Reactivate product ${productName}`;
  const buttonClassName = active ? "button-danger button-compact" : "button-secondary button-compact";

  async function onClick() {
    setError(null);
    setSuccess(null);
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
    setSuccess(active ? "Product deactivated. Existing deal and quote snapshots are unchanged." : "Product reactivated for new deal line items.");
    router.refresh();
  }

  return (
    <div className="inline-form">
      {error ? <FormErrorMessage compact>{error}</FormErrorMessage> : null}
      {success ? <FormSuccessMessage compact>{success}</FormSuccessMessage> : null}
      <button
        aria-label={actionLabel}
        className={buttonClassName}
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
