import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyComposition } from "../lib/apply-composition.mjs";
import { parseStyleProfile } from "../lib/style-profile.mjs";

const id = "12345678-1234-1234-1234-123456789abc";
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "editor-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dirs = Object.fromEntries(["generated", "uploads", "backups", "renders"].map(name => [name, path.join(root, name)]));
  await Promise.all(Object.values(dirs).map(dir => fs.mkdir(dir)));
  await fs.writeFile(path.join(root, "index.html"), "original composition");
  await fs.writeFile(path.join(dirs.generated, id + "-analysis.json"), JSON.stringify({ source: { file: "source.mp4" } }));
  await fs.writeFile(path.join(dirs.generated, id + "-composition.html"), '<video src="../uploads/source.mp4"></video>');
  return { root, dirs, id };
}

test("missing source leaves the current composition untouched", async t => {
  const context = await fixture(t);
  await assert.rejects(applyComposition({ ...context, runHyperframes: () => assert.fail("must not render") }), /Source video is missing/);
  assert.equal(await fs.readFile(path.join(context.root, "index.html"), "utf8"), "original composition");
});

test("failed render restores the composition and preserves previous renders", async t => {
  const context = await fixture(t);
  await fs.writeFile(path.join(context.dirs.uploads, "source.mp4"), "source");
  await fs.writeFile(path.join(context.dirs.renders, "previous.mp4"), "previous video");
  await assert.rejects(applyComposition({ ...context, runHyperframes: async args => {
    if (args[0] === "render") {
      await fs.writeFile(path.join(context.root, args[2]), "partial video");
      throw Error("Render failed");
    }
  } }), /previous composition was restored/);
  assert.equal(await fs.readFile(path.join(context.root, "index.html"), "utf8"), "original composition");
  assert.deepEqual(await fs.readdir(context.dirs.renders), ["previous.mp4"]);
});

test("successful apply uses portable output paths and backs up existing work", async t => {
  const context = await fixture(t);
  await fs.writeFile(path.join(context.dirs.uploads, "source.mp4"), "source");
  const result = await applyComposition({ ...context, runHyperframes: async args => {
    if (args[0] === "render") {
      assert.ok(args[2].startsWith("renders/"));
      assert.ok(!args[2].includes("\\"));
      await fs.writeFile(path.join(context.root, args[2]), "rendered video");
    }
  } });
  assert.equal(result.ok, true);
  assert.equal(await fs.readFile(path.join(context.root, result.backup), "utf8"), "original composition");
  assert.equal(await fs.readFile(path.join(context.root, "index.html"), "utf8"), '<video src="uploads/source.mp4"></video>');
});

test("invalid model output is rejected before the UI or generator consumes it", () => {
  for (const value of [null, [], { visualStyle: { palette: "gold" } }, { replicationPlan: "plan" }, { motion: { punchIns: "yes" } }]) {
    assert.throws(() => parseStyleProfile(value), /invalid style profile/);
  }
  assert.deepEqual(parseStyleProfile({}).replicationPlan, []);
});
