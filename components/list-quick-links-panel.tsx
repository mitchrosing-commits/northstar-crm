import Link from "next/link";
import type { Route } from "next";

import { Badge } from "@/components/badge";
import { PanelTitleRow } from "@/components/panel-title-row";
import type { ListSearchParams } from "@/lib/list-page-query";

export type ListQuickLink = {
  href: string;
  label: string;
};

type ListQuickLinksPanelProps = {
  ariaLabel: string;
  currentPath?: string;
  headingId: string;
  hint: string;
  links: readonly ListQuickLink[];
  searchParams?: ListSearchParams;
  title: string;
};

const ignoredQuickLinkParams = new Set(["page", "pageSize"]);

export function ListQuickLinksPanel({
  ariaLabel,
  currentPath,
  headingId,
  hint,
  links,
  searchParams,
  title
}: ListQuickLinksPanelProps) {
  const quickLinkCountLabel = `${links.length} ${links.length === 1 ? "shortcut" : "shortcuts"} in ${title.toLowerCase()}`;

  return (
    <section className="panel list-quick-links-panel" aria-labelledby={headingId}>
      <PanelTitleRow
        actions={
          <Badge className="count-badge" label={quickLinkCountLabel}>
            {links.length}
          </Badge>
        }
        actionsLabel={`${title} shortcut count`}
        description={hint}
        title={title}
        titleId={headingId}
      />
      <ul className="list-quick-link-list" aria-label={ariaLabel}>
        {links.map((link) => {
          const active = quickLinkIsActive(link.href, currentPath, searchParams);
          const quickLinkLabel = quickLinkActionLabel(title, link.label, active);
          const currentBadgeLabel = `${title}: ${link.label} is the current shortcut`;
          return (
            <li className={["list-quick-link-item", active ? "list-quick-link-item-active" : ""].filter(Boolean).join(" ")} key={link.href}>
              <Link
                aria-current={active ? "page" : undefined}
                aria-label={quickLinkLabel}
                className="inline-link"
                href={link.href as Route}
                title={quickLinkLabel}
              >
                <span>{link.label}</span>
                {active ? (
                  <Badge label={currentBadgeLabel}>
                    Current
                  </Badge>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function quickLinkActionLabel(title: string, label: string, active = false) {
  return active ? `${title}: ${label}, current shortcut` : `Apply ${title.toLowerCase()}: ${label}`;
}

export function quickLinkIsActive(href: string, currentPath?: string, searchParams: ListSearchParams = {}) {
  if (!currentPath) return false;

  const link = new URL(href, "https://northstar.local");
  if (link.pathname !== currentPath) return false;

  const linkEntries = Array.from(link.searchParams.entries()).filter(([key]) => !ignoredQuickLinkParams.has(key));
  if (linkEntries.length === 0) {
    return Object.entries(searchParams).every(([key, value]) => ignoredQuickLinkParams.has(key) || stringValues(value).length === 0);
  }

  return linkEntries.every(([key, value]) => stringValues(searchParams[key]).includes(value));
}

function stringValues(value: ListSearchParams[string]) {
  const values = Array.isArray(value) ? value : [value];
  return values.filter((item): item is string => typeof item === "string" && item.length > 0);
}
