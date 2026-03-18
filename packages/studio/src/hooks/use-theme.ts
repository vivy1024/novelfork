import { useState, useEffect } from "react";

export type Theme = "light" | "dark";

function getTimeBasedTheme(): Theme {
  const hour = new Date().getHours();
  return hour >= 6 && hour < 18 ? "light" : "dark";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getTimeBasedTheme);

  useEffect(() => {
    // Check every minute for time-based switch
    const timer = setInterval(() => {
      setTheme(getTimeBasedTheme());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  return { theme, setTheme };
}
