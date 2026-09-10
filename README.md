# Google Tasks MCP Server (personal, single-account)

Wraps the Google Tasks API so Claude can read/write the task-list items you
see inside Google Calendar (the checklist items — different from Calendar
*events*, which the Google Calendar connector already handles).

Runs as a small hosted HTTP service, so the scheduled dashboard refresh can
reach it from the cloud with your laptop off.

---

## 1. Google Cloud setup (you do this — ~10 min, one time)

1. Go to https://console.cloud.google.com/ and create a new project (or reuse
   one you already have), e.g. "benedict-tasks-mcp".
2. **Enable the API**: APIs & Services → Library → search "Google Tasks API"
   → Enable.
3. **Configure OAuth consent screen**: APIs & Services → OAuth consent screen
   → External → fill app name ("Benedict Tasks MCP"), your email as support
   contact → Save. You can leave it in "Testing" mode — add your own Google
   account (benedict2588@gmail.com) under "Test users".
4. **Create OAuth client**: APIs & Services → Credentials → Create
   Credentials → OAuth client ID → Application type: **Desktop app** → name
   it "tasks-mcp-authorize" → Create. Copy the **Client ID** and **Client
   secret** — you'll need them in step 2 below.

## 2. Get a refresh token (you do this — one time, on your own machine)

This step needs to run somewhere with a browser (your laptop), but it's a
one-off — after this, the token works forever (until you revoke it) and the
deployed server never needs your laptop again.

```bash
# unzip this project, then:
npm install
npm run build
GOOGLE_CLIENT_ID=<your client id> GOOGLE_CLIENT_SECRET=<your client secret> npm run authorize
```

It prints a URL — open it, log in as benedict2588@gmail.com, approve access.
Your terminal will then print:

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
```

Save those three values — they're the only secrets the live server needs.

## 3. Deploy the server (cloud, always-on)

Any small always-on Node host works — Render, Railway, Fly.io, a $5 VPS.
Quickest is **Render**:

1. Push this folder to a (private) GitHub repo.
2. Render → New → Web Service → connect the repo.
3. Build command: `npm install && npm run build`
4. Start command: `npm start`
5. Add environment variables:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REFRESH_TOKEN`
   - `MCP_SHARED_SECRET` — make up any long random string; this is what
     stops randoms on the internet from calling your task list. Claude will
     need to send it too (see step 4).
6. Deploy. Once live, note the URL, e.g. `https://benedict-tasks-mcp.onrender.com`.

The MCP endpoint is `POST https://<your-url>/mcp`.

## 4. Register it as a custom connector in Claude

In Claude's connector settings, add a custom connector:
- URL: `https://<your-url>/mcp`
- Auth: send header `Authorization: Bearer <MCP_SHARED_SECRET>` (however
  Claude's custom-connector UI lets you set a static header/bearer token —
  if it only supports OAuth, tell me and I'll add a proper OAuth layer
  instead of the shared-secret approach).

Once connected, tools like `google_tasks_list_tasklists` and
`google_tasks_list_tasks` show up, and the dashboard-refresh scheduled task
can call them the same way it already calls Google Calendar / Drive.

## Tools this server exposes

- `google_tasks_list_tasklists` — list your Google Tasks lists
- `google_tasks_list_tasks` — list tasks in a list (filter by due date, show/hide completed)
- `google_tasks_create_task`
- `google_tasks_update_task`
- `google_tasks_complete_task`
- `google_tasks_delete_task`

## Local test (optional, before deploying)

```bash
GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REFRESH_TOKEN=... npm start
# then in another terminal:
npx @modelcontextprotocol/inspector http://localhost:8787/mcp
```
