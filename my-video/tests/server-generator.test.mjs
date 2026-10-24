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

test("captions follow each transcript segment independently of video cuts", () => {
  const html = makeHtml("uploads/source.mp4", { duration: 10 },
    { editingPace: "slow" }, { segments: [
      { start: 1, end: 2, text: "First <caption>" },
      { start: 2, end: 3, text: "Second caption" },
      { start: 9, end: 12, text: "Clamped tail" }
    ] });
  assert.match(html, /id="caption-0"[^>]*data-start="1.000" data-duration="1.000"/);
  assert.match(html, /id="caption-1"[^>]*data-start="2.000" data-duration="1.000"/);
  assert.match(html, /id="caption-2"[^>]*data-start="9.000" data-duration="1.000"/);
  assert.ok(html.includes("First &lt;caption&gt;"));
  assert.match(html, /\.caption\{[^}]*z-index:2/);
});

test("missing transcription does not invent captions and explicit style options are respected", () => {
  const empty = makeHtml("uploads/source.mp4", { duration: 10 }, {}, { segments: [] });
  assert.doesNotMatch(empty, /YOUR HOOK GOES HERE|id="caption-/);
  const html = makeHtml("uploads/source.mp4", { duration: 10 }, {
    aspectRatio: "16:9", platform: "TikTok", captionStyle: { enabled: false }, motion: { punchIns: false }
  }, { segments: [{ start: 1, end: 2, text: "Hidden" }] });
  assert.match(html, /data-width="1920" data-height="1080"/);
  assert.doesNotMatch(html, /id="caption-|tl.fromTo/);
  for (const [aspectRatio, height] of [["1:1", 1080], ["4:5", 1350]]) {
    assert.ok(makeHtml("source.mp4", { duration: 10 }, { aspectRatio }, {}).includes(`data-width="1080" data-height="${height}"`));
  }
});

test("silent footage does not create an audio track referencing a missing stream", () => {
  const html = makeHtml("source.mp4", { duration: 10, hasAudio: false }, {}, {});
  assert.doesNotMatch(html, /<audio/);
  assert.match(html, /<video/);
});

test("long transcript segments become short caption groups without losing words", () => {
  const text = "one two three four five six seven eight nine ten eleven twelve thirteen";
  const html = makeHtml("source.mp4", { duration: 12 }, {}, {
    segments: [{ start: 1, end: 10, text }]
  });
  const captions = [...html.matchAll(/<div id="caption-\d+"[^>]*>([^<]+)<\/div>/g)].map(match => match[1]);
  assert.equal(captions.join(" "), text);
  assert.ok(captions.every(caption => caption.split(" ").length <= 6));
  assert.equal(captions.length, 3);
});
