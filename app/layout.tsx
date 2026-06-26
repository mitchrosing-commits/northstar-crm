import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Northstar CRM",
  description: "Multi-tenant sales CRM for pipeline and deal management"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
