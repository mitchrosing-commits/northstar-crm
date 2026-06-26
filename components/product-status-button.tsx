"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ProductStatusButtonProps = {
  workspaceId: string;
  productId: string;
  active: boolean;
};

export function ProductStatusButton({ workspaceId, productId, active }: ProductStatusButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const action = active ? "deactivate" : "activate";

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
      {error ? <div className="compact-error">{error}</div> : null}
      <button className="button-secondary button-compact" disabled={isSaving} onClick={onClick} type="button">
        {isSaving ? "Saving..." : active ? "Deactivate" : "Reactivate"}
      </button>
    </div>
  );
}
