// Narrow plugin-sdk surface for the bundled codesys-virtual-control plugin.
// Keep this list additive and scoped to symbols used under extensions/codesys-virtual-control.

export { emptyPluginConfigSchema } from "../plugins/config-schema.js";
export type {
  AnyAgentTool,
  OpenClawPluginApi,
  OpenClawPluginConfigSchema,
  OpenClawPluginService,
  OpenClawPluginServiceContext,
} from "../plugins/types.js";
