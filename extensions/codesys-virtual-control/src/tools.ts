import { Type } from "@sinclair/typebox";
import { DataType, Variant } from "node-opcua-client";
import type { AnyAgentTool } from "openclaw/plugin-sdk/codesys-virtual-control";
import type { CodesysVirtualControlConfig } from "./config.js";
import {
  inspectContainer,
  startContainer,
  stopContainer,
  containerLogs,
} from "./container.js";
import { CodesysOpcuaClient } from "./opcua-client.js";

/** Shared OPC UA client instance managed by the service layer. */
let sharedClient: CodesysOpcuaClient | null = null;

export function setSharedClient(client: CodesysOpcuaClient | null): void {
  sharedClient = client;
}

function getClient(): CodesysOpcuaClient {
  if (!sharedClient) {
    throw new Error("CODESYS OPC UA client not initialized. Is the service running?");
  }
  return sharedClient;
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function jsonResult(data: unknown) {
  return textResult(JSON.stringify(data, null, 2));
}

// ── Tool: plc_status ──────────────────────────────────────────────────

export function createPlcStatusTool(cfg: CodesysVirtualControlConfig) {
  return {
    name: "plc_status",
    label: "PLC Status",
    description:
      "Get the status of the CODESYS Virtual Control SL container and OPC UA connection.",
    parameters: Type.Object({}),
    async execute() {
      const containerInfo = await inspectContainer(cfg);
      const opcuaState = sharedClient?.state ?? "not_initialized";
      let serverInfo: Record<string, unknown> | undefined;
      if (sharedClient?.state === "connected") {
        try {
          serverInfo = await sharedClient.getServerInfo();
        } catch {
          // connection may have dropped
        }
      }
      return jsonResult({
        container: containerInfo,
        opcua: { state: opcuaState, ...serverInfo },
      });
    },
  } as unknown as AnyAgentTool;
}

// ── Tool: plc_start ───────────────────────────────────────────────────

export function createPlcStartTool(cfg: CodesysVirtualControlConfig) {
  return {
    name: "plc_start",
    label: "PLC Start",
    description:
      "Start the CODESYS Virtual Control SL container. Creates it if it doesn't exist.",
    parameters: Type.Object({}),
    async execute() {
      const info = await startContainer(cfg);
      // Auto-connect OPC UA after container starts
      if (info.state === "running" && sharedClient && sharedClient.state !== "connected") {
        try {
          await sharedClient.connect();
        } catch {
          // container may need a moment to initialize OPC UA
        }
      }
      return jsonResult({ container: info, opcua: sharedClient?.state ?? "not_initialized" });
    },
  } as unknown as AnyAgentTool;
}

// ── Tool: plc_stop ────────────────────────────────────────────────────

export function createPlcStopTool(cfg: CodesysVirtualControlConfig) {
  return {
    name: "plc_stop",
    label: "PLC Stop",
    description: "Stop the CODESYS Virtual Control SL container.",
    parameters: Type.Object({}),
    async execute() {
      if (sharedClient?.state === "connected") {
        await sharedClient.disconnect();
      }
      const info = await stopContainer(cfg);
      return jsonResult(info);
    },
  } as unknown as AnyAgentTool;
}

// ── Tool: plc_logs ────────────────────────────────────────────────────

export function createPlcLogsTool(cfg: CodesysVirtualControlConfig) {
  return {
    name: "plc_logs",
    label: "PLC Logs",
    description: "Fetch recent logs from the CODESYS Virtual Control SL container.",
    parameters: Type.Object({
      tail: Type.Optional(
        Type.Number({ description: "Number of log lines to retrieve (default 50)." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const tail = typeof params.tail === "number" ? params.tail : 50;
      const logs = await containerLogs(cfg, tail);
      return textResult(logs);
    },
  } as unknown as AnyAgentTool;
}

// ── Tool: plc_read ────────────────────────────────────────────────────

export function createPlcReadTool() {
  return {
    name: "plc_read",
    label: "PLC Read Variable",
    description:
      "Read one or more PLC variables from the CODESYS runtime via OPC UA. " +
      "Use node IDs like 'ns=4;s=Application.PLC_PRG.myVar'.",
    parameters: Type.Object({
      nodeIds: Type.Array(Type.String(), {
        description: "OPC UA node IDs to read.",
      }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const client = getClient();
      const nodeIds = params.nodeIds as string[];
      if (client.state !== "connected") {
        await client.connect();
      }
      const values = await client.readVariables(nodeIds);
      return jsonResult(values);
    },
  } as unknown as AnyAgentTool;
}

// ── Tool: plc_write ───────────────────────────────────────────────────

const DATA_TYPE_MAP: Record<string, DataType> = {
  boolean: DataType.Boolean,
  int16: DataType.Int16,
  int32: DataType.Int32,
  int64: DataType.Int64,
  uint16: DataType.UInt16,
  uint32: DataType.UInt32,
  uint64: DataType.UInt64,
  float: DataType.Float,
  double: DataType.Double,
  string: DataType.String,
  byte: DataType.Byte,
};

export function createPlcWriteTool() {
  return {
    name: "plc_write",
    label: "PLC Write Variable",
    description:
      "Write a value to a PLC variable in the CODESYS runtime via OPC UA. " +
      "Specify the node ID, value, and data type.",
    parameters: Type.Object({
      nodeId: Type.String({ description: "OPC UA node ID to write to." }),
      value: Type.Unknown({ description: "Value to write." }),
      dataType: Type.String({
        description:
          "OPC UA data type: boolean, int16, int32, int64, uint16, uint32, uint64, float, double, string, byte.",
      }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const client = getClient();
      if (client.state !== "connected") {
        await client.connect();
      }

      const nodeId = params.nodeId as string;
      const dataTypeStr = (params.dataType as string).toLowerCase();
      const dataType = DATA_TYPE_MAP[dataTypeStr];
      if (dataType === undefined) {
        throw new Error(
          `Unknown data type "${params.dataType}". Supported: ${Object.keys(DATA_TYPE_MAP).join(", ")}`,
        );
      }

      const variant = new Variant({ dataType, value: params.value });
      const statusCode = await client.writeVariable(nodeId, variant);
      return jsonResult({ nodeId, statusCode, written: params.value });
    },
  } as unknown as AnyAgentTool;
}

// ── Tool: plc_browse ──────────────────────────────────────────────────

export function createPlcBrowseTool() {
  return {
    name: "plc_browse",
    label: "PLC Browse Nodes",
    description:
      "Browse the OPC UA address space of the CODESYS runtime. " +
      "Lists child nodes under the given parent. Defaults to the Objects folder.",
    parameters: Type.Object({
      nodeId: Type.Optional(
        Type.String({
          description:
            "Parent node ID to browse from (default: ns=0;i=85 = Objects folder).",
        }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const client = getClient();
      if (client.state !== "connected") {
        await client.connect();
      }
      const nodeId = typeof params.nodeId === "string" ? params.nodeId : undefined;
      const nodes = await client.browseNode(nodeId);
      return jsonResult(nodes);
    },
  } as unknown as AnyAgentTool;
}

// ── Tool: plc_call_method ─────────────────────────────────────────────

export function createPlcCallMethodTool() {
  return {
    name: "plc_call_method",
    label: "PLC Call Method",
    description:
      "Call an OPC UA method on the CODESYS runtime. " +
      "Provide the object node ID and method node ID.",
    parameters: Type.Object({
      objectId: Type.String({ description: "Node ID of the object owning the method." }),
      methodId: Type.String({ description: "Node ID of the method to call." }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const client = getClient();
      if (client.state !== "connected") {
        await client.connect();
      }
      const result = await client.callMethod(
        params.objectId as string,
        params.methodId as string,
      );
      return jsonResult(result);
    },
  } as unknown as AnyAgentTool;
}

// ── Tool: plc_connect ─────────────────────────────────────────────────

export function createPlcConnectTool() {
  return {
    name: "plc_connect",
    label: "PLC Connect",
    description:
      "Manually connect the OPC UA client to the CODESYS Virtual Control SL runtime.",
    parameters: Type.Object({}),
    async execute() {
      const client = getClient();
      await client.connect();
      return jsonResult({ state: client.state, endpoint: (client as unknown as { endpoint: string }).endpoint });
    },
  } as unknown as AnyAgentTool;
}
