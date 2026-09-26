import { writable } from "svelte/store";

/**
 * Display density preference store.
 *
 * Values:
 * - "comfortable": Default padding and font sizes
 * - "compact": Reduced padding (~40% smaller), smaller monospace fonts, condensed timestamps
 */
export const density = writable<"comfortable" | "compact">("comfortable");

/**
 * Initialize density preference from localStorage
 */
export function initDensityStore() {
  const saved = localStorage.getItem("display-density");
  if (saved === "comfortable" || saved === "compact") {
    density.set(saved);
  }

  // Subscribe to changes and persist to localStorage
  return density.subscribe((value) => {
    localStorage.setItem("display-density", value);
  });
}

/**
 * Get CSS class for density mode
 */
export function densityClass(density: "comfortable" | "compact"): string {
  return density === "compact" ? "compact" : "comfortable";
}