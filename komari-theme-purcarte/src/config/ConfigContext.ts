import { createContext } from "react";
import type { ConfigOptions } from "./default";
import { DEFAULT_CONFIG } from "./default";

// 创建配置上下文
export const ConfigContext = createContext<ConfigOptions>(DEFAULT_CONFIG);
