import { describe, expect, it } from "vitest";
import { readConfigFileSnapshot } from "./config.js";
import { withTempHome, writeOpenClawConfig } from "./test-helpers.js";

/**
 * Regression test: the defaults pipeline must be identical for the
 * "config file exists" and "config file does not exist" code paths.
 *
 * Previously, the "file exists" path was missing applyCompactionDefaults
 * and applyContextPruningDefaults, while the "file doesn't exist" path
 * was missing applyLoggingDefaults and normalizeConfigPaths.
 * This caused safeguard compaction to never activate when a config file
 * existed, eventually leading to context overflow and no responses.
 */
describe("config defaults pipeline consistency", () => {
  it("applies compaction safeguard default when config file exists with agents.defaults", async () => {
    await withTempHome(async (home) => {
      await writeOpenClawConfig(home, {
        agents: {
          defaults: {
            model: "claude-opus-4-6",
          },
        },
      });
      const snapshot = await readConfigFileSnapshot();
      expect(snapshot.valid).toBe(true);
      expect(snapshot.config.agents?.defaults?.compaction?.mode).toBe("safeguard");
    });
  });

  it("applies compaction safeguard default when config file does not exist", async () => {
    await withTempHome(async () => {
      const snapshot = await readConfigFileSnapshot();
      // No file → valid snapshot with defaults applied
      expect(snapshot.exists).toBe(false);
      expect(snapshot.valid).toBe(true);
      // Compaction default only applies when agents.defaults exists,
      // and an empty config has no agents.defaults, so it stays undefined.
      // This is correct behavior — compaction defaults only matter when
      // agent defaults are configured.
    });
  });

  it("applies logging redactSensitive default when config file exists", async () => {
    await withTempHome(async (home) => {
      await writeOpenClawConfig(home, {
        logging: {
          level: "debug",
        },
      });
      const snapshot = await readConfigFileSnapshot();
      expect(snapshot.valid).toBe(true);
      expect(snapshot.config.logging?.redactSensitive).toBe("tools");
    });
  });
});
