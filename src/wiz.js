import dgram from "dgram";
import os from "os";

const PORT = 38899;
const DISCOVERY_TIMEOUT_MS = 2500;

function ipToInt(ip) {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function intToIp(value) {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join(".");
}

export function getBroadcastAddresses() {
  const addresses = new Set(["255.255.255.255"]);

  for (const ifaces of Object.values(os.networkInterfaces())) {
    if (!ifaces) continue;

    for (const iface of ifaces) {
      if (iface.family !== "IPv4" && iface.family !== 4) continue;
      if (iface.internal) continue;

      const ip = ipToInt(iface.address);
      const mask = ipToInt(iface.netmask);
      addresses.add(intToIp(ip | (~mask >>> 0)));
    }
  }

  return [...addresses];
}

function sendUdp(message, targetHost, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    const payload = Buffer.from(JSON.stringify(message));
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(value);
    };

    const timer = setTimeout(() => {
      finish({ error: "No response from light" });
    }, timeoutMs);

    socket.once("error", (err) => {
      settled = true;
      clearTimeout(timer);
      socket.close();
      reject(err);
    });

    socket.once("message", (data) => {
      try {
        finish(JSON.parse(data.toString()));
      } catch {
        finish({ raw: data.toString() });
      }
    });

    socket.send(payload, PORT, targetHost, (err) => {
      if (err) {
        settled = true;
        clearTimeout(timer);
        socket.close();
        reject(err);
      }
    });
  });
}

export function discoverLights() {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const lightsByIp = new Map();
    const message = { id: 1, method: "getPilot", params: {} };
    const payload = Buffer.from(JSON.stringify(message));

    socket.on("error", reject);

    socket.on("message", (data, rinfo) => {
      try {
        const response = JSON.parse(data.toString());
        const mac = response?.result?.mac ?? null;
        const state = response?.result?.state ?? null;

        lightsByIp.set(rinfo.address, {
          ip: rinfo.address,
          mac,
          state,
          response,
        });
      } catch {
        // ignore malformed packets
      }
    });

    socket.bind(0, () => {
      socket.setBroadcast(true);

      for (const broadcast of getBroadcastAddresses()) {
        socket.send(payload, PORT, broadcast);
        socket.send(payload, PORT, broadcast);
      }

      setTimeout(() => {
        socket.close();
        resolve([...lightsByIp.values()]);
      }, DISCOVERY_TIMEOUT_MS);
    });
  });
}

export async function setColor(ip, r, g, b, dimming = 100) {
  return sendUdp(
    {
      id: 1,
      method: "setPilot",
      params: { r, g, b, dimming },
    },
    ip,
    1000
  );
}

export function hexToRgb(hex) {
  const cleaned = hex.replace(/^#/, "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    throw new Error("Invalid hex color. Use format #RRGGBB");
  }

  return {
    r: parseInt(cleaned.slice(0, 2), 16),
    g: parseInt(cleaned.slice(2, 4), 16),
    b: parseInt(cleaned.slice(4, 6), 16),
  };
}
