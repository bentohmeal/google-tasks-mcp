import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { tasksApi } from "./google-tasks-client.js";

// ---------------------------------------------------------------------------
// MCP server definition — tools that wrap the Google Tasks API (v1)
// ---------------------------------------------------------------------------

function buildMcpServer() {
  const server = new McpServer({
    name: "google-tasks",
    version: "1.0.0",
  });

  server.registerTool(
    "google_tasks_list_tasklists",
    {
      title: "List Google Tasks lists",
      description:
        "Returns all of the user's Google Tasks lists (id + title). Call this first to find the tasklist id needed by the other tools, unless you already know it.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      const res = await tasksApi.tasklists.list({ maxResults: 100 });
      const lists = (res.data.items ?? []).map((l) => ({ id: l.id, title: l.title }));
      return {
        content: [{ type: "text", text: JSON.stringify(lists, null, 2) }],
        structuredContent: { tasklists: lists },
      };
    }
  );

  server.registerTool(
    "google_tasks_list_tasks",
    {
      title: "List tasks in a Google Tasks list",
      description:
        "Returns tasks from a given Google Tasks list. By default only shows incomplete tasks. Use google_tasks_list_tasklists first to get a tasklist id (or pass '@default' for the user's default list).",
      inputSchema: {
        tasklistId: z
          .string()
          .default("@default")
          .describe("The Google Tasks list id, or '@default' for the default list."),
        showCompleted: z
          .boolean()
          .default(false)
          .describe("Include completed tasks."),
        dueMin: z
          .string()
          .optional()
          .describe("RFC3339 timestamp — only return tasks due on or after this time."),
        dueMax: z
          .string()
          .optional()
          .describe("RFC3339 timestamp — only return tasks due on or before this time."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ tasklistId, showCompleted, dueMin, dueMax }) => {
      const res = await tasksApi.tasks.list({
        tasklist: tasklistId,
        showCompleted,
        showHidden: showCompleted,
        dueMin,
        dueMax,
        maxResults: 100,
      });
      const tasks = (res.data.items ?? []).map((t) => ({
        id: t.id,
        title: t.title,
        notes: t.notes,
        status: t.status,
        due: t.due,
        completed: t.completed,
        parent: t.parent,
        position: t.position,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }],
        structuredContent: { tasks },
      };
    }
  );

  server.registerTool(
    "google_tasks_create_task",
    {
      title: "Create a Google Task",
      description: "Creates a new task in the given Google Tasks list.",
      inputSchema: {
        tasklistId: z.string().default("@default"),
        title: z.string().describe("Task title."),
        notes: z.string().optional().describe("Task notes/description."),
        due: z
          .string()
          .optional()
          .describe("RFC3339 due date, e.g. 2026-09-15T00:00:00.000Z"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ tasklistId, title, notes, due }) => {
      const res = await tasksApi.tasks.insert({
        tasklist: tasklistId,
        requestBody: { title, notes, due },
      });
      return {
        content: [{ type: "text", text: `Created task "${res.data.title}" (id: ${res.data.id})` }],
        structuredContent: { id: res.data.id, title: res.data.title },
      };
    }
  );

  server.registerTool(
    "google_tasks_complete_task",
    {
      title: "Mark a Google Task complete",
      description: "Marks the given task as completed.",
      inputSchema: {
        tasklistId: z.string().default("@default"),
        taskId: z.string().describe("The task id (from google_tasks_list_tasks)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ tasklistId, taskId }) => {
      const res = await tasksApi.tasks.patch({
        tasklist: tasklistId,
        task: taskId,
        requestBody: { status: "completed" },
      });
      return { content: [{ type: "text", text: `Marked "${res.data.title}" complete.` }] };
    }
  );

  server.registerTool(
    "google_tasks_update_task",
    {
      title: "Update a Google Task",
      description: "Updates title, notes, or due date on an existing task.",
      inputSchema: {
        tasklistId: z.string().default("@default"),
        taskId: z.string(),
        title: z.string().optional(),
        notes: z.string().optional(),
        due: z.string().optional().describe("RFC3339 due date."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ tasklistId, taskId, title, notes, due }) => {
      const res = await tasksApi.tasks.patch({
        tasklist: tasklistId,
        task: taskId,
        requestBody: { title, notes, due },
      });
      return { content: [{ type: "text", text: `Updated "${res.data.title}".` }] };
    }
  );

  server.registerTool(
    "google_tasks_delete_task",
    {
      title: "Delete a Google Task",
      description: "Permanently deletes a task from a Google Tasks list.",
      inputSchema: {
        tasklistId: z.string().default("@default"),
        taskId: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ tasklistId, taskId }) => {
      await tasksApi.tasks.delete({ tasklist: tasklistId, task: taskId });
      return { content: [{ type: "text", text: `Deleted task ${taskId}.` }] };
    }
  );

  return server;
}

// ---------------------------------------------------------------------------
// Stateless streamable-HTTP transport wiring (per MCP best practice: a fresh
// server+transport per request, no session state to manage/scale).
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

// Simple shared-secret auth: set MCP_SHARED_SECRET and require it as a
// bearer token, since this server otherwise has no per-user login (it's
// wired to exactly one Google account via the refresh token).
const SHARED_SECRET = process.env.MCP_SHARED_SECRET;

app.post("/mcp", async (req, res) => {
  if (SHARED_SECRET) {
    const auth = req.header("authorization") ?? "";
    if (auth !== `Bearer ${SHARED_SECRET}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
  }

  try {
    const server = buildMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request failed:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
app.listen(PORT, () => {
  console.log(`google-tasks-mcp listening on :${PORT} (POST /mcp)`);
});
