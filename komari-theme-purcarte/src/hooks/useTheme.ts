import { useState, useEffect, createContext, useContext } from "react";
import { useConfigItem } from "@/config";
import { DEFAULT_CONFIG } from "@/config/default";

export const allowedColors = [
  "gray",
  "gold",
  "bronze",
  "brown",
  "yellow",
  "amber",
  "orange",
  "tomato",
  "red",
  "ruby",
  "crimson",
  "pink",
  "plum",
  "purple",
  "violet",
  "iris",
  "indigo",
  "blue",
  "cyan",
  "teal",
  "jade",
  "green",
  "grass",
  "lime",
  "mint",
  "sky",
] as const;

export type Colors = (typeof allowedColors)[number];

export const allowedAppearances = ["light", "dark", "system"] as const;
export type Appearance = (typeof allowedAppearances)[number];

export interface ThemeContextType {
  appearance: "light" | "dark";
  rawAppearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
  color: Colors;
  setColor: (color: Colors) => void;
  viewMode: "grid" | "table";
  setViewMode: (mode: "grid" | "table") => void;
  statusCardsVisibility: {
    currentTime: true;
    currentOnline: true;
    regionOverview: true;
    trafficOverview: true;
    networkSpeed: true;
  };
  setStatusCardsVisibility: (
    visibility: Partial<ThemeContextType["statusCardsVisibility"]>
  ) => void;
}

export const ThemeContext = createContext<ThemeContextType>({
  appearance: "light",
  rawAppearance: DEFAULT_CONFIG.selectedDefaultAppearance as Appearance,
  setAppearance: () => {},
  color: DEFAULT_CONFIG.selectThemeColor as Colors,
  setColor: () => {},
  viewMode: DEFAULT_CONFIG.selectedDefaultView as "grid" | "table",
  setViewMode: () => {},
  statusCardsVisibility: {
    currentTime: true,
    currentOnline: true,
    regionOverview: true,
    trafficOverview: true,
    networkSpeed: true,
  },
  setStatusCardsVisibility: () => {},
});

/**
 * Custom hook to convert "system" appearance to actual "light" or "dark" for Radix UI
 * @param appearance - The appearance setting from context ("light", "dark", or "system")
 * @returns The resolved appearance for Radix UI ("light" or "dark")
 */
export const useSystemTheme = (appearance: Appearance): "light" | "dark" => {
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(() => {
    // Initial system theme detection
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    return "light";
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? "dark" : "light");
    };

    // Add listener for system theme changes
    mediaQuery.addEventListener("change", handleChange);

    // Cleanup
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  // Return the resolved theme
  if (appearance === "system") {
    return systemTheme;
  }

  return appearance as "light" | "dark";
};

const useStoredState = <T>(
  key: string,
  defaultValue: T,
  validator?: (value: any) => value is T
): [T, React.Dispatch<React.SetStateAction<T>>] => {
  const enableLocalStorage = useConfigItem("enableLocalStorage");

  const [state, setState] = useState<T>(() => {
    if (enableLocalStorage) {
      try {
        const storedValue = localStorage.getItem(key);
        if (storedValue) {
          const parsedValue = JSON.parse(storedValue);
          if (!validator || validator(parsedValue)) {
            return parsedValue as T;
          }
        }
      } catch (error) {
        console.error("Error parsing stored state:", error);
        // Fallback to default value if parsing fails
      }
    }
    return defaultValue;
  });

  useEffect(() => {
    if (enableLocalStorage) {
      try {
        localStorage.setItem(key, JSON.stringify(state));
      } catch (error) {
        console.error("Error setting stored state:", error);
      }
    }
  }, [key, state, enableLocalStorage]);

  return [state, setState];
};

export const useThemeManager = () => {
  const defaultAppearance = useConfigItem(
    "selectedDefaultAppearance"
  ) as Appearance;
  const defaultColor = useConfigItem("selectThemeColor") as Colors;
  const defaultView = useConfigItem("selectedDefaultView") as "grid" | "table";
  const defaultStatusCardsVisibility = useConfigItem(
    "statusCardsVisibility"
  ) as string;

  const [appearance, setAppearance] = useStoredState<Appearance>(
    "appearance",
    defaultAppearance,
    (v): v is Appearance => allowedAppearances.includes(v)
  );

  const [color, setColor] = useStoredState<Colors>("color", defaultColor);

  const [viewMode, setViewMode] = useStoredState<"grid" | "table">(
    "nodeViewMode",
    defaultView
  );

  const [statusCardsVisibility, setStatusCardsVisibility] = useStoredState(
    "statusCardsVisibility",
    (() => {
      const visibility: { [key: string]: boolean } = {};
      defaultStatusCardsVisibility.split(",").forEach((item) => {
        const [key, value] = item.split(":");
        visibility[key] = value === "true";
      });
      return visibility as ThemeContextType["statusCardsVisibility"];
    })()
  );

  const handleSetStatusCardsVisibility = (
    newVisibility: Partial<ThemeContextType["statusCardsVisibility"]>
  ) => {
    setStatusCardsVisibility((prev) => ({ ...prev, ...newVisibility }));
  };

  const resolvedAppearance = useSystemTheme(appearance);

  return {
    appearance: resolvedAppearance,
    rawAppearance: appearance,
    setAppearance,
    color,
    setColor,
    viewMode,
    setViewMode,
    statusCardsVisibility,
    setStatusCardsVisibility: handleSetStatusCardsVisibility,
  };
};
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
