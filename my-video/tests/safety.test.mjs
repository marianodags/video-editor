import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { publicIp, videoResponse, exclusiveApply } from "../lib/safety.mjs";

test("downloads reject local, mapped, link-local and transition addresses", () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.2", "100.64.0.1",
    "169.254.169.254", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "fe90::1", "fd00::1",
    "ff02::1", "2002:7f00:1::", "2001:db8::1", "2001::1"]) {
    assert.equal(publicIp(ip), false, ip);
  }
  assert.equal(publicIp("8.8.8.8"), true);
  assert.equal(publicIp("2606:4700:4700::1111"), true);
});

test("download connections use the validated DNS address without resolving again", async () => {
  let lookups = 0;
  const response = {};
  const result = await videoResponse("https://example.com/a.mp4", async () => {
    lookups++;
    return [{ address: "8.8.8.8", family: 4 }];
  }, (url, options, callback) => {
    assert.equal(url.hostname, "example.com");
    options.lookup("example.com", {}, (error, address, family) => {
      assert.equal(error, null);
      assert.equal(address, "8.8.8.8");
      assert.equal(family, 4);
    });
    options.lookup("example.com", { all: true }, (error, addresses) => {
      assert.equal(error, null);
      assert.deepEqual(addresses, [{ address: "8.8.8.8", family: 4 }]);
    });
    callback(response);
    return new EventEmitter();
  });
  assert.equal(result, response);
  assert.equal(lookups, 1);
});

test("unsafe URL protocols and mixed public/private DNS fail before a connection", async () => {
  const connect = () => assert.fail("unsafe URLs must not connect");
  await assert.rejects(videoResponse("http://example.com/a.mp4", undefined, connect));
  await assert.rejects(videoResponse("https://example.com/a.mp4", async () => [
    { address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }
  ], connect));
});

test("apply remains locked until work finishes, including after client disconnect", () => {
  const lock = exclusiveApply();
  const first = new EventEmitter();
  first.locals = {};
  let started = 0;
  lock({}, first, () => started++);
  first.emit("close");
  const second = { locals: {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  lock({}, second, () => started++);
  assert.equal(second.code, 409);
  assert.equal(started, 1);
  first.locals.releaseApply();
  lock({}, second, () => started++);
  assert.equal(started, 2);
  second.locals.releaseApply();
});
