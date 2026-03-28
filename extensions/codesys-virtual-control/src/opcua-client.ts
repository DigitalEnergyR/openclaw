import {
  OPCUAClient,
  MessageSecurityMode,
  SecurityPolicy,
  AttributeIds,
  DataType,
  type ClientSession,
  type ClientSubscription,
  type DataValue,
  type Variant,
} from "node-opcua-client";
import type { CodesysVirtualControlConfig } from "./config.js";

export type OpcuaConnectionState = "disconnected" | "connecting" | "connected" | "error";

export type PlcVariable = {
  nodeId: string;
  displayName?: string;
  value: unknown;
  dataType: string;
  sourceTimestamp?: string;
  statusCode: string;
};

export type PlcNodeInfo = {
  nodeId: string;
  browseName: string;
  displayName: string;
  nodeClass: string;
};

/** Wraps the OPC UA connection to a CODESYS Virtual Control SL runtime. */
export class CodesysOpcuaClient {
  private client: OPCUAClient | null = null;
  private session: ClientSession | null = null;
  private subscription: ClientSubscription | null = null;
  private endpoint: string;
  private _state: OpcuaConnectionState = "disconnected";

  constructor(cfg: CodesysVirtualControlConfig) {
    this.endpoint = cfg.opcuaEndpoint;
  }

  get state(): OpcuaConnectionState {
    return this._state;
  }

  /** Connect to the CODESYS OPC UA server. */
  async connect(): Promise<void> {
    if (this._state === "connected") {
      return;
    }

    this._state = "connecting";
    try {
      this.client = OPCUAClient.create({
        applicationName: "OpenClaw-CODESYS-Client",
        connectionStrategy: {
          initialDelay: 1000,
          maxRetry: 3,
          maxDelay: 5000,
        },
        securityMode: MessageSecurityMode.None,
        securityPolicy: SecurityPolicy.None,
        endpointMustExist: false,
      });

      await this.client.connect(this.endpoint);
      this.session = await this.client.createSession();
      this._state = "connected";
    } catch (err) {
      this._state = "error";
      throw new Error(`OPC UA connection failed: ${String(err)}`);
    }
  }

  /** Disconnect from the OPC UA server. */
  async disconnect(): Promise<void> {
    try {
      if (this.subscription) {
        await this.subscription.terminate();
        this.subscription = null;
      }
      if (this.session) {
        await this.session.close();
        this.session = null;
      }
      if (this.client) {
        await this.client.disconnect();
        this.client = null;
      }
    } finally {
      this._state = "disconnected";
    }
  }

  /** Read a PLC variable by its OPC UA node ID. */
  async readVariable(nodeId: string): Promise<PlcVariable> {
    this.ensureConnected();
    const dataValue: DataValue = await this.session!.read({
      nodeId,
      attributeId: AttributeIds.Value,
    });

    return {
      nodeId,
      value: dataValue.value?.value,
      dataType: DataType[dataValue.value?.dataType ?? DataType.Null] ?? "Unknown",
      sourceTimestamp: dataValue.sourceTimestamp?.toISOString(),
      statusCode: dataValue.statusCode?.name ?? "Unknown",
    };
  }

  /** Read multiple PLC variables at once. */
  async readVariables(nodeIds: string[]): Promise<PlcVariable[]> {
    this.ensureConnected();
    const nodesToRead = nodeIds.map((nodeId) => ({
      nodeId,
      attributeId: AttributeIds.Value,
    }));
    const dataValues: DataValue[] = await this.session!.read(nodesToRead);

    return dataValues.map((dv, i) => ({
      nodeId: nodeIds[i]!,
      value: dv.value?.value,
      dataType: DataType[dv.value?.dataType ?? DataType.Null] ?? "Unknown",
      sourceTimestamp: dv.sourceTimestamp?.toISOString(),
      statusCode: dv.statusCode?.name ?? "Unknown",
    }));
  }

  /** Write a value to a PLC variable. */
  async writeVariable(nodeId: string, value: Variant): Promise<string> {
    this.ensureConnected();
    const statusCode = await this.session!.write({
      nodeId,
      attributeId: AttributeIds.Value,
      value: { value },
    });
    return statusCode.name ?? "Unknown";
  }

  /** Browse child nodes under a given parent node ID. */
  async browseNode(nodeId: string = "ns=0;i=85"): Promise<PlcNodeInfo[]> {
    this.ensureConnected();
    const browseResult = await this.session!.browse(nodeId);
    const references = browseResult.references ?? [];
    return references.map((ref) => ({
      nodeId: ref.nodeId.toString(),
      browseName: ref.browseName.toString(),
      displayName: ref.displayName?.text ?? ref.browseName.toString(),
      nodeClass: String(ref.nodeClass),
    }));
  }

  /** Call a method on the OPC UA server. */
  async callMethod(
    objectId: string,
    methodId: string,
    inputArguments: Variant[] = [],
  ): Promise<{ statusCode: string; outputArguments: unknown[] }> {
    this.ensureConnected();
    const result = await this.session!.call({
      objectId,
      methodId,
      inputArguments,
    });

    return {
      statusCode: result.statusCode.name ?? "Unknown",
      outputArguments: (result.outputArguments ?? []).map((v) => v.value),
    };
  }

  /** Get basic server info from the CODESYS runtime. */
  async getServerInfo(): Promise<Record<string, unknown>> {
    this.ensureConnected();
    const serverStateNode = "ns=0;i=2259"; // ServerState
    const serverNameNode = "ns=0;i=2254"; // ServerArray

    const [stateVal, nameVal] = await this.readVariables([serverStateNode, serverNameNode]);
    return {
      serverState: stateVal?.value,
      serverName: nameVal?.value,
      endpoint: this.endpoint,
      connectionState: this._state,
    };
  }

  private ensureConnected(): void {
    if (this._state !== "connected" || !this.session) {
      throw new Error("OPC UA client not connected. Call connect() first.");
    }
  }
}
