import { describe, expect, it, vi } from "vitest";
import type { CodesysVirtualControlConfig } from "./config.js";

// Mock child_process to avoid real docker calls
vi.mock("node:child_process", () => ({
  execFile: vi.fn((_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
    // For testing, simulate docker inspect returning "not found"
    if (args[0] === "inspect") {
      const err = new Error("No such object: codesys-virtual-plc");
      if (cb) {
        cb(err, "", "");
      } else {
        return { stdout: "", stderr: "" };
      }
    }
    if (cb) {
      cb(null, "", "");
    }
    return { stdout: "", stderr: "" };
  }),
}));

// Must import after mock is set up
const { inspectContainer } = await import("./container.js");

const testCfg: CodesysVirtualControlConfig = {
  image: "codesys/codesys-virtual-control-sl:latest",
  containerName: "codesys-virtual-plc",
  opcuaEndpoint: "opc.tcp://localhost:4840",
  autoStart: true,
  ports: { opcua: 4840, gateway: 11740, webVisu: 8080 },
};

describe("inspectContainer", () => {
  it("returns not_found when container does not exist", async () => {
    const info = await inspectContainer(testCfg);
    expect(info.state).toBe("not_found");
  });
});
