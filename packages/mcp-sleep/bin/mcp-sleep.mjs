#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "mcp-sleep",
  version: "0.1.0",
});

server.tool(
  "sleep",
  "Sleep for specified seconds. Returns timestamp when sleep started and ended.",
  {
    seconds: z.number().min(0).max(60).describe("Number of seconds to sleep (0-60)"),
  },
  async ({ seconds }) => {
    const startTime = Date.now();
    const startIso = new Date(startTime).toISOString();

    console.error(`[mcp-sleep] Starting sleep for ${seconds}s at ${startIso}`);

    await new Promise(resolve => setTimeout(resolve, seconds * 1000));

    const endTime = Date.now();
    const endIso = new Date(endTime).toISOString();
    const elapsed = endTime - startTime;

    console.error(`[mcp-sleep] Completed sleep for ${seconds}s at ${endIso}`);

    return {
      content: [
        {
          type: "text",
          text: `slept ${seconds}s (${elapsed}ms) from ${startIso} to ${endIso}`,
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
