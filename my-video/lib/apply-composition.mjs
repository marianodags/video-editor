import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function applyComposition({ root, dirs, id, runHyperframes }) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) throw Error("Invalid analysis ID.");
  const analysis = JSON.parse(await fs.readFile(path.join(dirs.generated, id + "-analysis.json"), "utf8"));
  const sourceName = String(analysis.source?.file || "");
  if (!sourceName || path.basename(sourceName) !== sourceName || /[\\/]/.test(sourceName)) {
    throw Error("Invalid source video filename.");
  }
  const source = await fs.stat(path.join(dirs.uploads, sourceName)).catch(() => null);
  if (!source?.isFile()) throw Error("Source video is missing. Restore it or run analysis again.");
  let html = await fs.readFile(path.join(dirs.generated, id + "-composition.html"), "utf8");
  html = html.replaceAll("../uploads/" + sourceName, "uploads/" + sourceName);
  const index = path.join(root, "index.html");
  const stampValue = new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID();
  const backup = path.join(dirs.backups, "index-before-ai-" + stampValue + ".html.bak");
  const temporary = path.join(root, ".apply-" + stampValue + ".tmp");
  let hadIndex = true;
  try { await fs.copyFile(index, backup); }
  catch (error) { if (error.code === "ENOENT") hadIndex = false; else throw error; }
  const output = "renders/ai-edit-" + stampValue + ".mp4";
  let replaced = false;
  try {
    await fs.writeFile(temporary, html, { flag: "wx" });
    await fs.rename(temporary, index);
    replaced = true;
    await runHyperframes(["check"]);
    const videos = (await fs.readdir(dirs.renders, { withFileTypes: true }))
      .filter(file => file.isFile() && /\.(mp4|mov|webm)$/i.test(file.name));
    const renderBackup = videos.length ? path.join(dirs.backups, "renders", stampValue) : null;
    if (renderBackup) {
      await fs.mkdir(renderBackup, { recursive: true });
      for (const file of videos) await fs.copyFile(path.join(dirs.renders, file.name), path.join(renderBackup, file.name));
    }
    await runHyperframes(["render", "--output", output]);
    const rendered = await fs.stat(path.join(root, output));
    if (!rendered.isFile() || !rendered.size) throw Error("Rendering did not produce a video file.");
    return {
      ok: true, backup: hadIndex ? path.relative(root, backup) : null, render: output,
      renderBackup: renderBackup ? path.relative(root, renderBackup) : null,
      message: "Composition applied and rendered successfully. Previous composition and existing renders were preserved."
    };
  } catch (error) {
    if (replaced) {
      try {
        if (hadIndex) await fs.copyFile(backup, index);
        else await fs.unlink(index);
      } catch (restoreError) {
        throw Error(`Apply failed: ${error.message}. Restoration also failed: ${restoreError.message}. Backup: ${backup}`);
      }
    }
    await fs.unlink(path.join(root, output)).catch(() => {});
    throw Error(`${error.message}${replaced ? " The previous composition was restored." : ""}`);
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}
