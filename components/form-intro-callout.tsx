import type { ReactNode } from "react";

import { FormCallout } from "@/components/form-callout";

type FormIntroCalloutProps = {
  children: ReactNode;
  className?: string;
  details?: ReactNode;
  title?: string;
};

export function FormIntroCallout({ children, className, details, title = "Before you save" }: FormIntroCalloutProps) {
  return (
    <FormCallout
      className={["form-intro-copy", className].filter(Boolean).join(" ")}
      details={details}
      title={title}
    >
      {children}
    </FormCallout>
  );
}
