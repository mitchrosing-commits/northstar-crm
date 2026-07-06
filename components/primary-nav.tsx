"use client";

import {
  BarChart3,
  BrainCircuit,
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
import Link from "next/link";
import { usePathname } from "next/navigation";

import { appNavigationGroups, appShellNavigationManifest, type AppNavigationIconName } from "@/lib/navigation";

const navigationIcons: Record<AppNavigationIconName, LucideIcon> = {
  BarChart3,
  BrainCircuit,
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
};

export function PrimaryNav() {
  const pathname = usePathname() ?? "";
  const groupedItems = appNavigationGroups.map((group) => ({
    label: group,
    items: appShellNavigationManifest.filter((item) => item.group === group && item.primary !== false)
  }));

  return (
    <nav aria-label="Primary">
      {groupedItems.map((group) => (
        <div className="nav-group" key={group.label}>
          <p className="nav-group-label" id={`primary-nav-${group.label.toLowerCase()}`}>
            {group.label}
          </p>
          <ul aria-labelledby={`primary-nav-${group.label.toLowerCase()}`} className="nav-list">
            {group.items.map((item) => {
              const Icon = navigationIcons[item.icon];
              const hrefPath = String(item.href).split("?")[0];
              const isActive = pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);
              const navItemLabel = primaryNavItemLabel(item.label, isActive);
              return (
                <li key={item.label}>
                  <Link
                    aria-current={isActive ? "page" : undefined}
                    aria-label={navItemLabel}
                    className={isActive ? "nav-item nav-item-active" : "nav-item"}
                    href={item.href}
                    title={navItemLabel}
                  >
                    <Icon size={17} aria-hidden="true" />
                    <span className="nav-item-label">{item.label}</span>
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

function primaryNavItemLabel(label: string, isActive: boolean) {
  return isActive ? `Current section: ${label}` : `Go to ${label}`;
}
