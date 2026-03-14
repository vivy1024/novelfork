import { Command } from "commander";
import { execSync } from "node:child_process";
import { log, logError } from "../utils.js";

export const updateCommand = new Command("update")
  .description("Update InkOS to the latest version")
  .action(async () => {
    try {
      log("Checking for updates...");

      const current = execSync("npm list -g @actalk/inkos --depth=0 --json 2>/dev/null", {
        encoding: "utf-8",
      });
      const currentVersion = JSON.parse(current)?.dependencies?.["@actalk/inkos"]?.version ?? "unknown";

      log(`Current version: ${currentVersion}`);
      log("Installing latest version...");

      execSync("npm install -g @actalk/inkos@latest", {
        stdio: "inherit",
      });

      const updated = execSync("inkos --version", { encoding: "utf-8" }).trim();
      if (updated === currentVersion) {
        log(`Already up to date (${updated}).`);
      } else {
        log(`Updated: ${currentVersion} → ${updated}`);
      }
    } catch (e) {
      logError(`Update failed: ${e}`);
      log("You can also update manually: npm install -g @actalk/inkos@latest");
      process.exit(1);
    }
  });
