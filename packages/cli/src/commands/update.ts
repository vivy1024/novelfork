import { readFileSync } from "node:fs";
import { Command } from "commander";
import { log, logError } from "../utils.js";

const { version: currentVersion } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf-8"),
) as { version: string };

export const updateCommand = new Command("update")
  .description("Update NovelFork to the latest version")
  .action(async () => {
    try {
      log(`Current version: ${currentVersion}`);
      log("Checking npm registry...");

      const response = await fetch("https://registry.npmjs.org/@vivy1024%2Fnovelfork-cli/latest");
      if (!response.ok) {
        throw new Error(`Registry request failed with ${response.status}`);
      }
      const latest = await response.json() as { version?: string };
      const remoteVersion = latest.version?.trim();
      if (!remoteVersion) {
        throw new Error("Registry response did not include a version");
      }

      if (currentVersion === remoteVersion) {
        log(`Already up to date (${currentVersion}).`);
        return;
      }

      // Don't downgrade development versions
      const current = currentVersion.split(".").map(Number);
      const remote = remoteVersion.split(".").map(Number);
      const isNewer = current[0]! > remote[0]! ||
        (current[0] === remote[0] && current[1]! > remote[1]!) ||
        (current[0] === remote[0] && current[1] === remote[1] && current[2]! > remote[2]!);

      if (isNewer) {
        log(`You're running a newer development version (${currentVersion} > ${remoteVersion}). Skipping.`);
        return;
      }

      log(`Update available: ${currentVersion} → ${remoteVersion}`);
      log("Manual update command: npm install -g @vivy1024/novelfork-cli@latest");
    } catch (e) {
      logError(`Update check failed: ${e}`);
      log("You can update manually with: npm install -g @vivy1024/novelfork-cli@latest");
      process.exit(1);
    }
  });
