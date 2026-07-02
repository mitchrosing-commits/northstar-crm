import type { ReactNode } from "react";

import { FormIntroCallout } from "@/components/form-intro-callout";

type QuotePrintNoticeProps = {
  children: ReactNode;
  title: string;
};

export function QuotePrintNotice({ children, title }: QuotePrintNoticeProps) {
  return (
    <FormIntroCallout className="quote-print-notice" title={title}>
      {children}
    </FormIntroCallout>
  );
}
