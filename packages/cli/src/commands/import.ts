import { Command } from "commander";
import { PipelineRunner } from "@actalk/inkos-core";
import { loadConfig, createClient, findProjectRoot, resolveBookId, log, logError } from "../utils.js";

export const importCommand = new Command("import")
  .description("Import external data into a book");

importCommand
  .command("canon")
  .description("Import parent book's canon for spinoff writing")
  .argument("[target-book-id]", "Target book ID (auto-detected if only one book)")
  .requiredOption("--from <parent-book-id>", "Parent book ID to import canon from")
  .option("--json", "Output JSON")
  .action(async (targetBookIdArg: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const targetBookId = await resolveBookId(targetBookIdArg, root);
      const config = await loadConfig();
      const client = createClient(config);

      const pipeline = new PipelineRunner({
        client,
        model: config.llm.model,
        projectRoot: root,
      });

      if (!opts.json) log(`Importing canon from "${opts.from}" into "${targetBookId}"...`);

      await pipeline.importCanon(targetBookId, opts.from);

      if (opts.json) {
        log(JSON.stringify({
          targetBookId,
          parentBookId: opts.from,
          output: "story/parent_canon.md",
        }, null, 2));
      } else {
        log(`Canon imported: story/parent_canon.md`);
        log(`Writer and auditor will auto-detect this file for spinoff mode.`);
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Canon import failed: ${e}`);
      }
      process.exit(1);
    }
  });
