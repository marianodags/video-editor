import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const server = fs.readFileSync(path.join(here, "..", "server.mjs"), "utf8");
const start = server.indexOf("function makeHtml(");
const end = server.indexOf("\nasync function clean", start);
assert.ok(start >= 0 && end > start, "makeHtml generator should exist in server.mjs");
const generatorSource = server.slice(start, end);
const context = {
  esc(value) {
    return String(value).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }
};
vm.runInNewContext(generatorSource + "\nthis.makeHtml = makeHtml;", context);
const makeHtml = context.makeHtml;

test("generated composition preserves full source duration and includes original audio", () => {
  const duration = 140.52;
  const html = makeHtml("../uploads/source.mp4",
    { duration, width: 720, height: 1280 },
    { editingPace: "fast", aspectRatio: "9:16", platform: "TikTok", visualStyle: { palette: ["black", "white"] } },
    { segments: [{ start: 0, end: 2, text: "Opening caption" }, { start: 138, end: 140.5, text: "Ending caption" }] }
  );
  assert.match(html, /data-composition-id="main"/);
  assert.match(html, new RegExp('data-duration="' + duration + '" data-width="1080" data-height="1920"'));
  assert.match(html, /<audio id="source-audio" class="clip"[^>]*data-duration="140\.52"[^>]*data-track-index="2"[^>]*src="\.\.\/uploads\/source\.mp4"/);
  assert.doesNotMatch(html, /<\\\/script>/);
  assert.equal((html.match(/<\/script>/g) || []).length, 2, "both HTML script tags should close correctly");
  const clips = [...html.matchAll(/<video id="shot-\d+"[^>]*data-start="([\d.]+)"[^>]*data-duration="([\d.]+)"/g)];
  assert.ok(clips.length > 24, "long footage should not be capped at 24 clips");
  const last = clips.at(-1);
  assert.ok(Math.abs(Number(last[1]) + Number(last[2]) - duration) < 0.002, "final clip should reach the source duration");
  assert.ok(html.includes('src="../uploads/source.mp4" muted'), "video clips should be muted because audio is carried on the dedicated audio track");
});

test("generated composition does not clamp long sources to 60 seconds", () => {
  assert.doesNotMatch(server.slice(start, end), /Math\.min\(60/);
  assert.doesNotMatch(server.slice(start, end), /Math\.min\(24/);
});
