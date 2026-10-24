import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.join(here, "..");
const server = fs.readFileSync(path.join(projectDir, "server.mjs"), "utf8");
const applySource = fs.readFileSync(path.join(projectDir, "lib", "apply-composition.mjs"), "utf8");

// HyperFrames Studio's lint route lints every .html file in the project except inside
// dot-folders and node_modules, treating anything that is not index.html as a
// sub-composition. This mirrors that discovery so stray HTML shows up here first.
function discoverableHtml(dir, prefix = "") {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...discoverableHtml(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith(".html")) found.push(rel);
  }
  return found;
}

test("only real compositions are visible to Studio lint", () => {
  const stray = discoverableHtml(projectDir).filter(
    file => file !== "index.html" && !file.startsWith("compositions/")
  );
  assert.deepEqual(
    stray,
    [],
    "These .html files would be linted as sub-compositions and report false findings. " +
      "Move previews into .generated/, the studio page into .studio/, and rename backups to *.html.bak: " +
      stray.join(", ")
  );
});

test("server keeps non-composition HTML out of Studio lint's reach", () => {
  assert.ok(server.includes('["generated",".generated"]'), "generated previews should live in .generated/");
  assert.ok(server.includes('path.join(root,".studio")'), "studio page should be served from .studio/");
  assert.ok(server.includes('s.sendFile("studio.html",{root:studioDir})'), "studio page should be sent from .studio/");
  assert.ok(
    applySource.includes('"index-before-ai-" + stampValue + ".html.bak"'),
    "composition backups should be saved as *.html.bak"
  );
});
