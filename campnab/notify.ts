/**
 * Notification sinks for the watch loop. All are dependency-free.
 *   - console: prints to stderr with a terminal bell
 *   - webhook: POSTs JSON (shaped for Discord `content` + Slack `text`)
 *   - exec:    runs a shell command with CAMPNAB_* env vars set
 */

export interface NotifyPayload {
  title: string;
  text: string;
  /** Booking deep-link for the opening. */
  url: string;
  /** Resource ids that just opened. */
  resourceIds: number[];
}

export interface Notifier {
  notify(payload: NotifyPayload): Promise<void>;
}

export function consoleNotifier(write: (s: string) => void = (s) => process.stderr.write(s)): Notifier {
  return {
    async notify(payload) {
      // \x07 rings the terminal bell.
      write(`\x07\n=== ${payload.title} ===\n${payload.text}\n${payload.url}\n`);
    },
  };
}

type PostFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

export function webhookNotifier(webhookUrl: string, postImpl?: PostFn): Notifier {
  const post: PostFn =
    postImpl ??
    ((url, init) => (globalThis as { fetch: PostFn }).fetch(url, init) as ReturnType<PostFn>);
  return {
    async notify(payload) {
      const message = `${payload.text}\n${payload.url}`;
      const body = JSON.stringify({
        // `content` works for Discord webhooks, `text` for Slack. Sending both
        // is harmless - each service reads the key it understands.
        content: message,
        text: message,
        title: payload.title,
        url: payload.url,
        resourceIds: payload.resourceIds,
      });
      const res = await post(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!res.ok) {
        throw new Error(`Webhook POST failed with ${res.status}`);
      }
    },
  };
}

type SpawnFn = (
  command: string,
  env: Record<string, string>,
) => Promise<void>;

export function execNotifier(command: string, spawnImpl?: SpawnFn): Notifier {
  const run: SpawnFn =
    spawnImpl ??
    (async (cmd, env) => {
      const { spawn } = await import("node:child_process");
      await new Promise<void>((resolve, reject) => {
        const child = spawn(cmd, { shell: true, stdio: "inherit", env: { ...process.env, ...env } });
        child.on("error", reject);
        child.on("close", (code) =>
          code === 0 ? resolve() : reject(new Error(`exec command exited with ${code}`)),
        );
      });
    });
  return {
    async notify(payload) {
      await run(command, {
        CAMPNAB_TITLE: payload.title,
        CAMPNAB_TEXT: payload.text,
        CAMPNAB_URL: payload.url,
        CAMPNAB_SITES: payload.resourceIds.join(","),
      });
    },
  };
}

/** Fan a payload out to every notifier, isolating individual failures. */
export async function notifyAll(notifiers: Notifier[], payload: NotifyPayload): Promise<void> {
  await Promise.all(
    notifiers.map(async (n) => {
      try {
        await n.notify(payload);
      } catch (err) {
        process.stderr.write(`notify failed: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }),
  );
}
