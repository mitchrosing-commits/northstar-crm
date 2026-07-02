import type { ReactNode } from "react";

type CompactListProps = {
  as?: "div" | "ul";
  children: ReactNode;
  className?: string;
};

type CompactListItemProps = {
  as?: "div" | "li";
  children: ReactNode;
  className?: string;
};

export function CompactList({ as: Component = "div", children, className }: CompactListProps) {
  return (
    <Component className={["compact-list", className].filter(Boolean).join(" ")}>
      {children}
    </Component>
  );
}

export function CompactListItem({ as: Component = "div", children, className }: CompactListItemProps) {
  return (
    <Component className={["compact-list-item", className].filter(Boolean).join(" ")}>
      {children}
    </Component>
  );
}
