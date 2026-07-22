import { describe, expect, it, vi } from "vitest";
import {
  consoleNotifier,
  execNotifier,
  type NotifyPayload,
  notifyAll,
  webhookNotifier,
} from "./notify.ts";

const payload: NotifyPayload = {
  title: "Campsite opening",
  text: "2 site(s) opened",
  url: "https://reservation.pc.gc.ca/create-booking/results?mapId=-1",
  resourceIds: [-201, -202],
};

describe("consoleNotifier", () => {
  it("writes the payload and rings the bell", async () => {
    const out: string[] = [];
    await consoleNotifier((s) => out.push(s)).notify(payload);
    const text = out.join("");
    expect(text).toContain("\x07");
    expect(text).toContain("Campsite opening");
    expect(text).toContain(payload.url);
  });
});

describe("webhookNotifier", () => {
  it("POSTs a Discord/Slack-compatible JSON body", async () => {
    const post = vi.fn(async () => ({ ok: true, status: 200 }));
    await webhookNotifier("https://hooks.example/abc", post).notify(payload);
    expect(post).toHaveBeenCalledTimes(1);
    const [url, init] = post.mock.calls[0];
    expect(url).toBe("https://hooks.example/abc");
    const body = JSON.parse(init.body);
    expect(body.content).toContain("2 site(s) opened");
    expect(body.text).toContain(payload.url);
    expect(body.resourceIds).toEqual([-201, -202]);
  });

  it("throws when the webhook rejects", async () => {
    const post = vi.fn(async () => ({ ok: false, status: 429 }));
    await expect(webhookNotifier("https://hooks.example/abc", post).notify(payload)).rejects.toThrow(/429/);
  });
});

describe("execNotifier", () => {
  it("runs the command with CAMPNAB_* env vars", async () => {
    const spawn = vi.fn(async () => {});
    await execNotifier("notify-send $CAMPNAB_TEXT", spawn).notify(payload);
    const [cmd, env] = spawn.mock.calls[0];
    expect(cmd).toBe("notify-send $CAMPNAB_TEXT");
    expect(env.CAMPNAB_TEXT).toBe("2 site(s) opened");
    expect(env.CAMPNAB_SITES).toBe("-201,-202");
    expect(env.CAMPNAB_URL).toBe(payload.url);
  });
});

describe("notifyAll", () => {
  it("delivers to all notifiers and isolates failures", async () => {
    const ok = { notify: vi.fn(async () => {}) };
    const bad = { notify: vi.fn(async () => { throw new Error("boom"); }) };
    const errs: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(((s: string) => { errs.push(s); return true; }) as never);
    await notifyAll([ok, bad], payload);
    spy.mockRestore();
    expect(ok.notify).toHaveBeenCalledTimes(1);
    expect(bad.notify).toHaveBeenCalledTimes(1);
    expect(errs.join("")).toContain("boom");
  });
});
