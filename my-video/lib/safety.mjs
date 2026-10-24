import net from "node:net";
import dns from "node:dns/promises";
import https from "node:https";

export function publicIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) || (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)));
  }
  // Accept global unicast only; exclude mapped IPv4, local, multicast,
  // documentation, and transition ranges that can tunnel private addresses.
  if (!net.isIPv6(ip)) return false;
  const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1).toLowerCase();
  const first = parseInt(normalized.split(":")[0], 16);
  return first >= 0x2000 && first <= 0x3fff &&
    !/^2001:(?::|0:|2:|db8:|10:|20:)/.test(normalized) && !normalized.startsWith("2002:");
}

export async function videoResponse(raw, lookup = dns.lookup, request = https.get) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw Error("Only public HTTPS video URLs without credentials or custom ports are supported.");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(hostname)
    ? [{ address: hostname, family: net.isIP(hostname) }]
    : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !publicIp(address))) {
    throw Error("URL host is not a verified public host.");
  }
  // Pin the checked address to this connection, preventing a second DNS
  // resolution from switching a public hostname to a private address.
  return new Promise((resolve, reject) => {
    const pinned = addresses[0];
    const req = request(url, {
      agent: false,
      signal: AbortSignal.timeout(45000),
      lookup: (_host, options, callback) => options.all
        ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family)
    }, resolve);
    req.on("error", reject);
  });
}

export function localRequests(req, res, next) {
  const host = req.headers.host || "";
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) {
    return res.status(403).json({ error: "Use the localhost studio address." });
  }
  if (req.headers["sec-fetch-site"] === "cross-site" ||
      (req.headers.origin && req.headers.origin !== `http://${host}`)) {
    return res.status(403).json({ error: "Cross-origin requests are not allowed." });
  }
  next();
}

export function exclusiveApply() {
  let busy = false;
  return (req, res, next) => {
    if (busy) return res.status(409).json({ error: "An edit is already being applied. Wait for it to finish." });
    busy = true;
    // Do not release on client disconnect: rendering may still be running.
    res.locals.releaseApply = () => { busy = false; };
    next();
  };
}
