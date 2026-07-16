import { McpServer } from "../../packages/narrafork-runtime-private/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js";
import { StdioServerTransport } from "../../packages/narrafork-runtime-private/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js";
import { z } from "../../packages/narrafork-runtime-private/node_modules/zod/index.js";

const server = new McpServer({ name: "novelfork-e2e-memory", version: "1.0.0" });

server.tool(
  "recall",
  "Read a value from the isolated E2E memory server",
  { key: z.string().optional() },
  async ({ key }) => ({ content: [{ type: "text", text: key ?? "isolated-memory" }] }),
);

await server.connect(new StdioServerTransport());
