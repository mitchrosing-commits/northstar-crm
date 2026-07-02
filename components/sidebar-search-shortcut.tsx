"use client";

import { useEffect } from "react";

type SidebarSearchShortcutProps = {
  inputId?: string;
};

const textEntryTags = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function SidebarSearchShortcut({ inputId = "global-search" }: SidebarSearchShortcutProps) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isSlash = event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey;
      const isCommandSearch = event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey);
      if (isSlash && isTextEntryTarget(event.target)) return;
      if (!isSlash && !isCommandSearch) return;

      const input = document.getElementById(inputId);
      if (!(input instanceof HTMLInputElement)) return;
      event.preventDefault();
      input.focus();
      input.select();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inputId]);

  return null;
}

function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return textEntryTags.has(target.tagName);
}
