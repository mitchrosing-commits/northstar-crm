import type { Metadata } from "next";

import "./globals.css";

const appIconVersion = "northstar-favicon-20260710";

export const metadata: Metadata = {
  applicationName: "Northstar CRM",
  title: "Northstar CRM",
  description: "Multi-tenant sales CRM for pipeline and deal management",
  icons: {
    icon: [
      { url: `/favicon.ico?v=${appIconVersion}`, sizes: "any" },
      { url: `/icon.svg?v=${appIconVersion}`, type: "image/svg+xml" }
    ],
    apple: [{ url: `/apple-icon.png?v=${appIconVersion}`, sizes: "180x180", type: "image/png" }],
    shortcut: [`/favicon.ico?v=${appIconVersion}`]
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
