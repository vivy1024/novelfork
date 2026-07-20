import { queryClient } from "@vivy1024/narrafork-runtime-bridge/frontend/query-client";

const narratorCommandsQueryKey = ["narrator-commands"] as const;

/** Refreshes every narrator slash-command menu after a product routine changes. */
export function invalidateNarratorCommands(): Promise<void> {
	return queryClient.invalidateQueries({ queryKey: narratorCommandsQueryKey });
}
