import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk/codesys-virtual-control";
import { codesysConfigSchema, parseConfig } from "./src/config.js";
import { createCodesysService } from "./src/service.js";
import {
  createPlcStatusTool,
  createPlcStartTool,
  createPlcStopTool,
  createPlcLogsTool,
  createPlcReadTool,
  createPlcWriteTool,
  createPlcBrowseTool,
  createPlcCallMethodTool,
  createPlcConnectTool,
} from "./src/tools.js";

const plugin = {
  id: "codesys-virtual-control",
  name: "CODESYS Virtual Control SL",
  description: "Your PLC in a container - manage a CODESYS Virtual Control SL runtime via Docker and communicate through OPC UA.",
  configSchema: codesysConfigSchema,

  register(api: OpenClawPluginApi) {
    const cfg = parseConfig(api.pluginConfig);

    // Register the background service (container lifecycle + OPC UA connection).
    api.registerService(createCodesysService(cfg));

    // Register agent tools for PLC interaction.
    const tools: AnyAgentTool[] = [
      createPlcStatusTool(cfg) as unknown as AnyAgentTool,
      createPlcStartTool(cfg) as unknown as AnyAgentTool,
      createPlcStopTool(cfg) as unknown as AnyAgentTool,
      createPlcLogsTool(cfg) as unknown as AnyAgentTool,
      createPlcReadTool() as unknown as AnyAgentTool,
      createPlcWriteTool() as unknown as AnyAgentTool,
      createPlcBrowseTool() as unknown as AnyAgentTool,
      createPlcCallMethodTool() as unknown as AnyAgentTool,
      createPlcConnectTool() as unknown as AnyAgentTool,
    ];

    for (const tool of tools) {
      api.registerTool(tool, { optional: true });
    }
  },
};

export default plugin;
