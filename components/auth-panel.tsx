import type { ReactNode } from "react";

type AuthPanelProps = {
  children: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  title?: ReactNode;
};

export function AuthPanel({ children, description, eyebrow = "Northstar CRM", title }: AuthPanelProps) {
  return (
    <main className="login-page">
      <section className="login-panel">
        {eyebrow ? <p className="page-kicker">{eyebrow}</p> : null}
        {title ? <h1 className="page-title">{title}</h1> : null}
        {description ? <p className="empty-copy">{description}</p> : null}
        {children}
      </section>
    </main>
  );
}
