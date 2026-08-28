/**
 * Plugin lifecycle listener contracts.
 *
 * Decoupled from {@link RuntimePluginHost} so the product runtime can register
 * books into a host independent of core plugin activation.
 */

import type { NovelForkPlugin } from "./plugin-base.js";
import type { PluginManifest } from "./types.js";

/**
 * Snapshot handed to listeners *after* the plugin is active but *before* the
 * product host registers its contribution.  If `onActivationPrepared` throws,
 * the manager compensates: core registrations are rolled back and the plugin
 * is deactivated.
 */
export interface CorePluginActivationSnapshot {
  readonly pluginName: string;
  readonly manifest: PluginManifest;
  readonly tools: ReturnType<NovelForkPlugin["getTools"]>;
}

/**
 * Listener a product host may supply when constructing a {@link PluginManager}
 * (see `PluginManagerConfig.lifecycleListener`).
 *
 * - `onActivationPrepared` runs during {@link PluginManager.activate} after
 *   core registrations succeed; a thrown error triggers compensation.
 * - `onDeactivating` runs first during {@link PluginManager.deactivate}, while
 *   the projection is still visible; a failure aborts deactivation before any
 *   core or plugin cleanup happens.
 * - `onDeactivated` runs after everything succeeded; failures are logged but
 *   do not roll back the deactivated state.
 */
export interface PluginManagerLifecycleListener {
  onActivationPrepared(snapshot: CorePluginActivationSnapshot): Promise<void> | void;
  onDeactivating(pluginName: string): Promise<void> | void;
  onDeactivated(pluginName: string): Promise<void> | void;
}
