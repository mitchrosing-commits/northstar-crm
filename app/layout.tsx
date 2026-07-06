import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  applicationName: "Northstar CRM",
  title: "Northstar CRM",
  description: "Multi-tenant sales CRM for pipeline and deal management",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" }
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/favicon.ico"]
  },
  appleWebApp: {
    title: "Northstar CRM"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
