import type { OpenClawPluginConfigSchema } from "openclaw/plugin-sdk/codesys-virtual-control";

export type CodesysVirtualControlConfig = {
  /** Docker image for the CODESYS Virtual Control SL runtime. */
  image: string;
  /** Container name. */
  containerName: string;
  /** OPC UA endpoint URL exposed by the runtime. */
  opcuaEndpoint: string;
  /** Whether to auto-start the container when the service starts. */
  autoStart: boolean;
  /** Port mappings: host -> container. */
  ports: {
    /** OPC UA port (default 4840). */
    opcua: number;
    /** CODESYS gateway port (default 11740). */
    gateway: number;
    /** Web visualization port (default 8080). */
    webVisu: number;
  };
};

const DEFAULTS: CodesysVirtualControlConfig = {
  image: "codesys/codesys-virtual-control-sl:latest",
  containerName: "codesys-virtual-plc",
  opcuaEndpoint: "opc.tcp://localhost:4840",
  autoStart: true,
  ports: {
    opcua: 4840,
    gateway: 11740,
    webVisu: 8080,
  },
};

type Issue = { path: Array<string | number>; message: string };
type SafeParseResult =
  | { success: true; data: CodesysVirtualControlConfig }
  | { success: false; error: { issues: Issue[] } };

function error(message: string): SafeParseResult {
  return { success: false, error: { issues: [{ path: [], message }] } };
}

export function parseConfig(value: unknown): CodesysVirtualControlConfig {
  if (value === undefined || value === null) {
    return { ...DEFAULTS, ports: { ...DEFAULTS.ports } };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULTS, ports: { ...DEFAULTS.ports } };
  }
  const v = value as Record<string, unknown>;
  const ports = typeof v.ports === "object" && v.ports && !Array.isArray(v.ports)
    ? (v.ports as Record<string, unknown>)
    : {};

  return {
    image: typeof v.image === "string" ? v.image : DEFAULTS.image,
    containerName: typeof v.containerName === "string" ? v.containerName : DEFAULTS.containerName,
    opcuaEndpoint: typeof v.opcuaEndpoint === "string" ? v.opcuaEndpoint : DEFAULTS.opcuaEndpoint,
    autoStart: typeof v.autoStart === "boolean" ? v.autoStart : DEFAULTS.autoStart,
    ports: {
      opcua: typeof ports.opcua === "number" ? ports.opcua : DEFAULTS.ports.opcua,
      gateway: typeof ports.gateway === "number" ? ports.gateway : DEFAULTS.ports.gateway,
      webVisu: typeof ports.webVisu === "number" ? ports.webVisu : DEFAULTS.ports.webVisu,
    },
  };
}

export const codesysConfigSchema: OpenClawPluginConfigSchema = {
  safeParse(value: unknown): SafeParseResult {
    if (value === undefined) {
      return { success: true, data: { ...DEFAULTS, ports: { ...DEFAULTS.ports } } };
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return { success: true, data: parseConfig(value) };
    }
    return error("expected config object or undefined");
  },
  jsonSchema: {
    type: "object",
    properties: {
      image: { type: "string", description: "Docker image for CODESYS Virtual Control SL" },
      containerName: { type: "string", description: "Docker container name" },
      opcuaEndpoint: { type: "string", description: "OPC UA endpoint URL" },
      autoStart: { type: "boolean", description: "Auto-start container on service start" },
      ports: {
        type: "object",
        properties: {
          opcua: { type: "number", description: "OPC UA port (default 4840)" },
          gateway: { type: "number", description: "CODESYS gateway port (default 11740)" },
          webVisu: { type: "number", description: "Web visualization port (default 8080)" },
        },
      },
    },
  },
};
