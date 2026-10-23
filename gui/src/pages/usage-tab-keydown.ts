import type { KeyboardEvent } from "react";

export type UsageTab = "report" | "context" | "companion";

export function readUsageTab(): UsageTab {
  const hash = window.location.hash.replace(/^#\/?/, "");
  return hash === "usage/context" ? "context" : hash === "usage/companion" ? "companion" : "report";
}

export function selectUsageTab(next: UsageTab): void {
  window.location.hash = next === "report" ? "usage" : `usage/${next}`;
}

export function usageTabKeyDown(event: KeyboardEvent): void {
  if (event.key === "ArrowLeft" || event.key === "Home" || event.key === "ArrowRight" || event.key === "End") {
    event.preventDefault();
    const tabs: UsageTab[] = ["report", "context", "companion"];
    const index = tabs.indexOf(readUsageTab());
    const next = event.key === "Home" ? "report" : event.key === "End" ? "companion"
      : tabs[(index + (event.key === "ArrowLeft" ? 2 : 1)) % tabs.length]!;
    selectUsageTab(next);
    document.getElementById(`usage-tab-${next}`)?.focus();
  }
}
