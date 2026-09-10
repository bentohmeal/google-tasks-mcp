/**
 * ONE-TIME SETUP SCRIPT — run this yourself, once, on your own machine.
 *
 * It walks you through Google's OAuth consent screen, then prints a
 * refresh token. That refresh token (plus your client id/secret) is
 * everything the deployed MCP server needs — you never have to run
 * this again unless you revoke access.
 *
 * Usage:
 *   GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy npm run authorize
 */
import { google } from "googleapis";
import http from "node:http";
import { URL } from "node:url";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:53682/oauth2callback";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars first (from your Google Cloud OAuth client)."
  );
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent", // forces a refresh_token to be issued even on repeat runs
  scope: ["https://www.googleapis.com/auth/tasks"],
});

console.log("\n1. Open this URL in your browser and approve access:\n");
console.log(authUrl);
console.log("\n2. Waiting for the redirect back to localhost...\n");

const server = http.createServer(async (req, res) => {
  if (!req.url) return;
  const url = new URL(req.url, REDIRECT_URI);
  if (url.pathname !== "/oauth2callback") return;

  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("Missing code");
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h2>Done — you can close this tab and go back to the terminal.</h2>");

    console.log("\n=== SAVE THESE — set them as env vars on your deployed server ===\n");
    console.log("GOOGLE_CLIENT_ID=" + CLIENT_ID);
    console.log("GOOGLE_CLIENT_SECRET=" + CLIENT_SECRET);
    console.log("GOOGLE_REFRESH_TOKEN=" + tokens.refresh_token);
    console.log("\n===================================================================\n");
  } catch (err) {
    console.error("Token exchange failed:", err);
    res.writeHead(500).end("Token exchange failed, check terminal.");
  } finally {
    server.close();
  }
});

server.listen(53682, () => {
  console.log("Listening on http://localhost:53682 for the OAuth redirect...");
});
