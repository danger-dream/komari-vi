import { type ReactNode, useEffect, useMemo } from "react";
import type { PublicInfo } from "@/types/node.d";
import { ConfigContext } from "./ConfigContext";
import { DEFAULT_CONFIG, type ConfigOptions } from "./default";

// 配置提供者属性类型
interface ConfigProviderProps {
  publicSettings: PublicInfo | null; // 公共设置，可能为 null
  children: ReactNode;
}

/**
 * 配置提供者组件，用于将配置传递给子组件
 */
export function ConfigProvider({
  publicSettings,
  children,
}: ConfigProviderProps) {
  const config: ConfigOptions = useMemo(() => {
    const themeSettings =
      (publicSettings?.theme_settings as ConfigOptions) || {};
    const mergedConfig = {
      ...DEFAULT_CONFIG,
      ...themeSettings,
      titleText:
        themeSettings.titleText ||
        publicSettings?.sitename ||
        DEFAULT_CONFIG.titleText,
    };

    return mergedConfig;
  }, [publicSettings]);

  useEffect(() => {
    const { backgroundImage, blurValue, blurBackgroundColor } = config;

    if (backgroundImage) {
      document.body.style.setProperty(
        "--body-background-url",
        `url(${backgroundImage})`
      );
    } else {
      document.body.style.removeProperty("--body-background-url");
    }

    document.documentElement.style.setProperty(
      "--purcarte-blur",
      `${blurValue}px`
    );

    if (blurBackgroundColor) {
      const colors = blurBackgroundColor
        .split("|")
        .map((color) => color.trim());
      if (colors.length >= 2) {
        document.documentElement.style.setProperty("--card-light", colors[0]);
        document.documentElement.style.setProperty("--card-dark", colors[1]);
      } else if (colors.length === 1) {
        document.documentElement.style.setProperty("--card-light", colors[0]);
        document.documentElement.style.setProperty("--card-dark", colors[0]);
      }
    }
  }, [config]);

  return (
    <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>
  );
}
