import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CodesysVirtualControlConfig } from "./config.js";

const exec = promisify(execFile);

export type ContainerState = "running" | "stopped" | "not_found" | "error";

export type ContainerInfo = {
  state: ContainerState;
  id?: string;
  image?: string;
  status?: string;
  ports?: string;
};

async function docker(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  return exec("docker", args, { timeout: 30_000 });
}

/** Inspect the current state of the CODESYS container. */
export async function inspectContainer(cfg: CodesysVirtualControlConfig): Promise<ContainerInfo> {
  try {
    const { stdout } = await docker(
      "inspect",
      "--format",
      '{{.Id}}\t{{.Config.Image}}\t{{.State.Status}}\t{{(index (index .NetworkSettings.Ports "4840/tcp") 0).HostPort}}',
      cfg.containerName,
    );
    const [id, image, status, opcuaPort] = stdout.trim().split("\t");
    const state: ContainerState = status === "running" ? "running" : "stopped";
    return { state, id, image, status, ports: opcuaPort ? `OPC-UA: ${opcuaPort}` : undefined };
  } catch (err) {
    const msg = String(err);
    if (msg.includes("No such object") || msg.includes("not found")) {
      return { state: "not_found" };
    }
    return { state: "error", status: msg.slice(0, 200) };
  }
}

/** Start (or create + start) the CODESYS Virtual Control SL container. */
export async function startContainer(cfg: CodesysVirtualControlConfig): Promise<ContainerInfo> {
  const info = await inspectContainer(cfg);

  if (info.state === "running") {
    return info;
  }

  if (info.state === "stopped" && info.id) {
    await docker("start", cfg.containerName);
    return inspectContainer(cfg);
  }

  // Container doesn't exist - create and run it.
  await docker(
    "run",
    "-d",
    "--name", cfg.containerName,
    "--hostname", "codesys-plc",
    "--privileged",
    "-p", `${cfg.ports.opcua}:4840`,
    "-p", `${cfg.ports.gateway}:11740`,
    "-p", `${cfg.ports.webVisu}:8080`,
    "--restart", "unless-stopped",
    cfg.image,
  );
  return inspectContainer(cfg);
}

/** Stop the CODESYS container. */
export async function stopContainer(cfg: CodesysVirtualControlConfig): Promise<ContainerInfo> {
  const info = await inspectContainer(cfg);
  if (info.state === "not_found") {
    return info;
  }
  try {
    await docker("stop", cfg.containerName);
  } catch {
    // may already be stopped
  }
  return inspectContainer(cfg);
}

/** Remove the CODESYS container entirely. */
export async function removeContainer(cfg: CodesysVirtualControlConfig): Promise<void> {
  try {
    await docker("rm", "-f", cfg.containerName);
  } catch {
    // ignore if not found
  }
}

/** Fetch container logs. */
export async function containerLogs(
  cfg: CodesysVirtualControlConfig,
  tail: number = 50,
): Promise<string> {
  try {
    const { stdout, stderr } = await docker("logs", "--tail", String(tail), cfg.containerName);
    return (stdout + stderr).trim();
  } catch (err) {
    return `Error fetching logs: ${String(err).slice(0, 200)}`;
  }
}
