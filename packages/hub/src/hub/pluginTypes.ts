/**
 * plugin.json 结构
 */
export interface PluginManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author?: string;
  readonly entry?: string;
  readonly license?: string;
  readonly keywords?: readonly string[];
  readonly dependencies?: readonly string[];
  readonly tools?: readonly PluginToolDef[];
}

/**
 * plugin.json 中的 tool 定义
 */
export interface PluginToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: "object";
    readonly properties?: Readonly<Record<string, Record<string, unknown>>>;
    readonly required?: readonly string[];
  };
}

/**
 * plugins.lock.json 结构
 */
export interface PluginsLock {
  readonly plugins: Readonly<Record<string, PluginLockEntry>>;
}

/**
 * plugins.lock.json 中的单个插件条目
 */
export interface PluginLockEntry {
  readonly version: string;
  readonly source: string;
  readonly marketplace: string | null;
  readonly installedAt: string;
  readonly hash: string;
}

/**
 * marketplace.json 结构
 */
export interface MarketplaceManifest {
  readonly name: string;
  readonly plugins: readonly MarketplacePlugin[];
}

/**
 * marketplace.json 中的单个插件条目
 */
export interface MarketplacePlugin {
  readonly name: string;
  readonly description: string;
  readonly source: string;
}

/**
 * ~/.roblox-studio-hub/marketplaces.json 结构
 */
export interface MarketplacesConfig {
  readonly marketplaces: readonly string[];
}
