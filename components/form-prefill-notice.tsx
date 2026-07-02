import type { ReactNode } from "react";

type FormPrefillNoticeProps = {
  children: ReactNode;
};

export function FormPrefillNotice({ children }: FormPrefillNoticeProps) {
  return <p className="form-hint form-callout-copy form-prefill-notice">{children}</p>;
}
