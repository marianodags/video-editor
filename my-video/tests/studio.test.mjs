import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

test("the studio blocks reset, duplicate submission and apply while analysis runs", async () => {
  const html = fs.readFileSync(new URL("../.studio/studio.html", import.meta.url), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const nodes = new Map();
  function element(id) {
    if (!nodes.has(id)) nodes.set(id, {
      disabled: false, files: [], value: "", listeners: {},
      addEventListener(name, listener) { this.listeners[name] = listener; },
      classList: { add() {}, remove() {} },
      reset() { assert.fail("reset must not run during analysis"); }
    });
    return nodes.get(id);
  }
  let resolveAnalysis;
  let requests = 0;
  const context = {
    document: { getElementById: element, querySelectorAll: () => [...nodes.values()] },
    FormData: class { append() {} },
    confirm: () => assert.fail("apply must not ask or run during analysis"),
    fetch: async url => {
      if (url === "/api/health") return { json: async () => ({ groqConfigured: true, maxVideoBytes: 200 }) };
      assert.equal(url, "/api/analyze");
      requests++;
      return new Promise(resolve => { resolveAnalysis = resolve; });
    }
  };
  vm.runInNewContext(script, context);
  element("referenceVideo").files = [{}];
  element("sourceVideo").files = [{}];
  const submit = element("form").listeners.submit;
  const pending = submit({ preventDefault() {} });
  assert.equal(element("reset").disabled, true);
  assert.equal(element("apply").disabled, true);
  element("reset").listeners.click();
  await element("apply").listeners.click();
  await submit({ preventDefault() {} });
  assert.equal(requests, 1);
  resolveAnalysis({ ok: false, json: async () => ({ error: "Test failure" }) });
  await pending;
  assert.equal(element("reset").disabled, false);
  assert.equal(element("apply").disabled, false);
  context.showRender({ render: "renders/result.mp4" });
  assert.equal(element("renderPreview").src, "/renders/result.mp4");
  assert.equal(element("renderPreview").hidden, false);
  assert.equal(element("preview").hidden, true);
  assert.equal(element("downloadRender").href, "/renders/result.mp4");
});
