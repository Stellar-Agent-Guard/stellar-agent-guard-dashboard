"use client";

import { useTheme } from "./ThemeProvider.tsx";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <select
      className="theme-toggle"
      value={theme}
      onChange={(e) => setTheme(e.target.value as any)}
      aria-label="Select theme"
      style={{ width: "auto", padding: "4px 8px", fontSize: "13px" }}
    >
      <option value="dark">Dark</option>
      <option value="light">Light</option>
      <option value="high-contrast">High Contrast</option>
    </select>
  );
}
