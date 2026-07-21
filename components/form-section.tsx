import type { ReactNode } from "react";

type FormSectionProps = {
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  title: ReactNode;
};

export function FormSection({ children, className, description, title }: FormSectionProps) {
  return (
    <section className={["form-section", className].filter(Boolean).join(" ")}>
      <div className="form-section-header">
        <h3 className="form-section-title">{title}</h3>
        {description ? <div className="form-section-description">{description}</div> : null}
      </div>
      {children}
    </section>
  );
}
