"use client";

import * as React from "react";

type Theme = "dark" | "light";

const ThemeContext = React.createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({
  theme: "dark",
  setTheme: () => {},
});

function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>("dark");

  React.useEffect(() => {
    let stored: Theme | null = null;
    try {
      const raw = localStorage.getItem("airborne-theme");
      if (raw === "light" || raw === "dark") stored = raw;
    } catch {
      /* ignore */
    }
    setThemeState(stored ?? getSystemTheme());
  }, []);

  React.useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("airborne-theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const setTheme = React.useCallback((t: Theme) => setThemeState(t), []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return React.useContext(ThemeContext);
}
