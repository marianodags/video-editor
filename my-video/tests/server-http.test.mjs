import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.GROQ_API_KEY = "";
const { app } = await import("../server.mjs");

test("local HTTP routes protect project files and reject cross-site writes", async t => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base)).status, 200);
  for (const file of ["/server.mjs", "/package.json", "/.env", "/backups/index.html.bak", "/tests/server-http.test.mjs"]) {
    const response = await fetch(base + file);
    assert.equal(response.status, 404, file);
  }
  const rebound = await new Promise((resolve, reject) => {
    http.get(base, { headers: { Host: "evil.example" } }, response => {
      response.resume();
      resolve(response.statusCode);
    }).on("error", reject);
  });
  assert.equal(rebound, 403);
  assert.equal((await fetch(base + "/api/apply", {
    method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}"
  })).status, 403);
  for (let i = 0; i < 2; i++) {
    // Invalid requests must release the lock, allowing the next request.
    assert.equal((await fetch(base + "/api/apply", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "invalid" })
    })).status, 400);
  }
});
