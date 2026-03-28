import type {
  OpenClawPluginService,
} from "openclaw/plugin-sdk/codesys-virtual-control";
import type { CodesysVirtualControlConfig } from "./config.js";
import { inspectContainer, startContainer } from "./container.js";
import { CodesysOpcuaClient } from "./opcua-client.js";
import { setSharedClient } from "./tools.js";

export function createCodesysService(cfg: CodesysVirtualControlConfig): OpenClawPluginService {
  let client: CodesysOpcuaClient | null = null;

  return {
    id: "codesys-virtual-control",

    async start(ctx) {
      ctx.logger.info("codesys-virtual-control: starting service");

      // Initialize the OPC UA client (connection is deferred until the container is running).
      client = new CodesysOpcuaClient(cfg);
      setSharedClient(client);

      if (!cfg.autoStart) {
        ctx.logger.info("codesys-virtual-control: autoStart disabled, skipping container launch");
        return;
      }

      // Check if the container exists and start if needed.
      const info = await inspectContainer(cfg);
      if (info.state !== "running") {
        ctx.logger.info(
          `codesys-virtual-control: container state=${info.state}, starting...`,
        );
        try {
          const started = await startContainer(cfg);
          ctx.logger.info(
            `codesys-virtual-control: container started (state=${started.state})`,
          );
        } catch (err) {
          ctx.logger.warn(
            `codesys-virtual-control: failed to auto-start container: ${String(err)}`,
          );
          return;
        }
      }

      // Give the CODESYS runtime a moment to initialize its OPC UA server,
      // then attempt to connect.
      await delay(3000);
      try {
        await client.connect();
        ctx.logger.info("codesys-virtual-control: OPC UA connected");
      } catch (err) {
        ctx.logger.warn(
          `codesys-virtual-control: OPC UA connection deferred: ${String(err)}`,
        );
      }
    },

    async stop(ctx) {
      ctx.logger.info("codesys-virtual-control: stopping service");
      if (client) {
        try {
          await client.disconnect();
        } catch {
          // best-effort
        }
        setSharedClient(null);
        client = null;
      }
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
