"use client";

import {
  BarChart3,
  Building2,
  CalendarCheck,
  CircleDollarSign,
  Contact,
  Inbox,
  LayoutDashboard,
  Package,
  PanelsTopLeft,
  Search,
  Settings,
  SlidersHorizontal
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems: Array<{ href: Route; label: string; icon: LucideIcon; group: "Work" | "System" }> = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, group: "Work" },
  { href: "/pipeline", label: "Pipeline", icon: PanelsTopLeft, group: "Work" },
  { href: "/deals" as Route, label: "Deals", icon: CircleDollarSign, group: "Work" },
  { href: "/contacts", label: "Contacts", icon: Contact, group: "Work" },
  { href: "/organizations", label: "Organizations", icon: Building2, group: "Work" },
  { href: "/leads", label: "Leads", icon: Contact, group: "Work" },
  { href: "/activities", label: "Activities", icon: CalendarCheck, group: "Work" },
  { href: "/email" as Route, label: "Email", icon: Inbox, group: "Work" },
  { href: "/reports" as Route, label: "Reports", icon: BarChart3, group: "Work" },
  { href: "/products" as Route, label: "Products", icon: Package, group: "Work" },
  { href: "/search" as Route, label: "Search", icon: Search, group: "System" },
  { href: "/custom-fields" as Route, label: "Custom Fields", icon: SlidersHorizontal, group: "System" },
  { href: "/settings" as Route, label: "Settings", icon: Settings, group: "System" }
];

export function PrimaryNav() {
  const pathname = usePathname();
  const groupedItems = [
    { label: "Work", items: navItems.filter((item) => item.group === "Work") },
    { label: "System", items: navItems.filter((item) => item.group === "System") }
  ];

  return (
    <nav aria-label="Primary">
      {groupedItems.map((group) => (
        <div className="nav-group" key={group.label}>
          <p className="nav-group-label">{group.label}</p>
          <ul className="nav-list">
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.label}>
                  <Link aria-current={isActive ? "page" : undefined} className={isActive ? "nav-item nav-item-active" : "nav-item"} href={item.href}>
                    <Icon size={17} aria-hidden="true" />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
