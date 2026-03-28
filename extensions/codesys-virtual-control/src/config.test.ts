import { describe, expect, it } from "vitest";
import { codesysConfigSchema, parseConfig } from "./config.js";

describe("parseConfig", () => {
  it("returns defaults when called with undefined", () => {
    const cfg = parseConfig(undefined);
    expect(cfg.image).toBe("codesys/codesys-virtual-control-sl:latest");
    expect(cfg.containerName).toBe("codesys-virtual-plc");
    expect(cfg.opcuaEndpoint).toBe("opc.tcp://localhost:4840");
    expect(cfg.autoStart).toBe(true);
    expect(cfg.ports.opcua).toBe(4840);
    expect(cfg.ports.gateway).toBe(11740);
    expect(cfg.ports.webVisu).toBe(8080);
  });

  it("returns defaults when called with null", () => {
    const cfg = parseConfig(null);
    expect(cfg.containerName).toBe("codesys-virtual-plc");
  });

  it("returns defaults for non-object values", () => {
    const cfg = parseConfig("not-an-object");
    expect(cfg.image).toBe("codesys/codesys-virtual-control-sl:latest");
  });

  it("merges partial config with defaults", () => {
    const cfg = parseConfig({
      containerName: "my-plc",
      ports: { opcua: 5840 },
    });
    expect(cfg.containerName).toBe("my-plc");
    expect(cfg.image).toBe("codesys/codesys-virtual-control-sl:latest");
    expect(cfg.ports.opcua).toBe(5840);
    expect(cfg.ports.gateway).toBe(11740);
  });

  it("overrides all fields when provided", () => {
    const cfg = parseConfig({
      image: "custom/image:v2",
      containerName: "custom-plc",
      opcuaEndpoint: "opc.tcp://192.168.1.100:4841",
      autoStart: false,
      ports: { opcua: 5840, gateway: 12740, webVisu: 9080 },
    });
    expect(cfg.image).toBe("custom/image:v2");
    expect(cfg.containerName).toBe("custom-plc");
    expect(cfg.opcuaEndpoint).toBe("opc.tcp://192.168.1.100:4841");
    expect(cfg.autoStart).toBe(false);
    expect(cfg.ports.opcua).toBe(5840);
    expect(cfg.ports.gateway).toBe(12740);
    expect(cfg.ports.webVisu).toBe(9080);
  });
});

describe("codesysConfigSchema", () => {
  it("safeParse succeeds with undefined", () => {
    const result = codesysConfigSchema.safeParse!(undefined);
    expect(result.success).toBe(true);
  });

  it("safeParse succeeds with valid config", () => {
    const result = codesysConfigSchema.safeParse!({ containerName: "test-plc" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as { containerName: string }).containerName).toBe("test-plc");
    }
  });

  it("safeParse fails with array", () => {
    const result = codesysConfigSchema.safeParse!([]);
    expect(result.success).toBe(false);
  });

  it("safeParse fails with string", () => {
    const result = codesysConfigSchema.safeParse!("bad");
    expect(result.success).toBe(false);
  });
});
