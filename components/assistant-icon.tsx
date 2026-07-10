import { forwardRef } from "react";
import type { LucideIcon, LucideProps } from "lucide-react";

export const AssistantIcon: LucideIcon = forwardRef<SVGSVGElement, LucideProps>(function AssistantIcon(
  { size = 20, strokeWidth = 1.9, ...props },
  ref
) {
  return (
    <svg
      fill="none"
      height={size}
      ref={ref}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <circle cx="12" cy="12" fill="currentColor" opacity="0.12" r="8.5" />
      <path
        d="M12 3.75l1.64 6.61 6.61 1.64-6.61 1.64L12 20.25l-1.64-6.61L3.75 12l6.61-1.64L12 3.75Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <path d="M12 8.55v6.9M8.55 12h6.9" stroke="currentColor" strokeLinecap="round" strokeWidth={strokeWidth} />
      <circle cx="18.25" cy="5.75" fill="currentColor" r="1.25" />
    </svg>
  );
});
