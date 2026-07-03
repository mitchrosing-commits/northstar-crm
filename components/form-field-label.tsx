import type { ReactNode } from "react";

import { Badge } from "@/components/badge";

type FormFieldLabelProps = {
  children: ReactNode;
  required?: boolean;
};

export function FormFieldLabel({ children, required = false }: FormFieldLabelProps) {
  const requirementLabel = required ? "Required field" : "Optional field";

  return (
    <span className="form-field-label">
      <span>{children}</span>
      <Badge label={requirementLabel}>
        {required ? "Required" : "Optional"}
      </Badge>
    </span>
  );
}
