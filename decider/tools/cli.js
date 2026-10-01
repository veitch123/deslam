// One call to the local Claude CLI in print mode, prompt on stdin, structured JSON back.
// Stripped of Claude Code's own context (no tools, no MCP servers, no settings) so the
// only tokens are the task's. Returns { data, usage, model, ms, cost, raw }.
"use strict";
const { spawn } = require("child_process");
const fs = require("fs"), path = require("path"), os = require("os");
const emptyMcp = path.join(os.tmpdir(), "decider-empty-mcp.json");
if (!fs.existsSync(emptyMcp)) fs.writeFileSync(emptyMcp, '{"mcpServers":{}}');
function call({ model, system, message, schema, timeoutMs = 15 * 60e3, maxAttempts = 3 }) {
  const args = ["-p", "--model", model, "--output-format", "json", "--strict-mcp-config", "--mcp-config", emptyMcp,
    "--system-prompt", system, "--tools", "", "--max-turns", "1", "--setting-sources", "", "--json-schema", JSON.stringify(schema)];
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`timeout after ${timeoutMs} ms`)); }, timeoutMs);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", () => {
      clearTimeout(timer);
      let j; try { j = JSON.parse(out); } catch { return reject(new Error(`not JSON from CLI: ${out.slice(0, 300)} ${err.slice(0, 300)}`)); }
      if (j.is_error) return reject(new Error(`CLI error: ${String(j.result).slice(0, 300)}`));
      const mu = j.modelUsage ? Object.values(j.modelUsage)[0] : null;
      resolve({ data: j.structured_output ?? null, text: j.result, usage: j.usage, model: mu?.canonicalModel ?? model, modelUsage: j.modelUsage, cost: j.total_cost_usd, ms: Date.now() - started, apiMs: j.duration_api_ms, sessionId: j.session_id });
    });
    child.stdin.end(message);
  });
}
module.exports = { call };
