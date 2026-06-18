import dgram from "dgram";
import os from "os";

const PORT = 38899;
const DISCOVERY_TIMEOUT_MS = 5000;
const DISCOVERY_SEND_INTERVAL_MS = 400;

const GET_PILOT = { id: 1, method: "getPilot", params: {} };
const REGISTRATION = {
  method: "registration",
  params: {
    phoneMac: "AAAAAAAAAAAA",
    register: false,
    phoneIp: "1.2.3.4",
    id: "1",
  },
};

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

function isIPv4(iface) {
  return iface.family === "IPv4" || iface.family === 4;
}

export function getLocalIPv4Networks() {
  const networks = [];

  for (const ifaces of Object.values(os.networkInterfaces())) {
    if (!ifaces) continue;

    for (const iface of ifaces) {
      if (!isIPv4(iface) || iface.internal || !iface.netmask) continue;

      const ip = ipToInt(iface.address);
      const mask = ipToInt(iface.netmask);
      const broadcast = intToIp(ip | (~mask >>> 0));
      const prefix = iface.address.split(".").slice(0, 3).join(".") + ".";

      networks.push({
        address: iface.address,
        broadcast,
        prefix,
      });
    }
  }

  return networks;
}

export function getBroadcastAddresses() {
  const subnetBroadcasts = new Set();

  for (const network of getLocalIPv4Networks()) {
    subnetBroadcasts.add(network.broadcast);
  }

  // Subnet broadcast first — more reliable on macOS than 255.255.255.255 alone.
  return [...subnetBroadcasts, "255.255.255.255"];
}

function wizPayload(message) {
  return Buffer.from(JSON.stringify(message));
}

function sendBroadcast(socket, message, broadcast) {
  const payload = wizPayload(message);
  socket.send(payload, PORT, broadcast);
}

function probeLight(ip, timeoutMs = 350) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const payload = wizPayload(GET_PILOT);
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(value);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    socket.once("error", () => finish(null));

    socket.once("message", (data, rinfo) => {
      try {
        const response = JSON.parse(data.toString());
        if (response?.result?.mac || response?.method === "getPilot") {
          finish({
            ip: rinfo.address,
            mac: response?.result?.mac ?? null,
            state: response?.result?.state ?? null,
            response,
          });
          return;
        }
      } catch {
        // ignore
      }
      finish(null);
    });

    socket.send(payload, PORT, ip, (err) => {
      if (err) finish(null);
    });
  });
}

async function scanLocalSubnets(existing) {
  const lightsByIp = new Map(existing.map((light) => [light.ip, light]));
  const networks = getLocalIPv4Networks();

  for (const network of networks) {
    const batchSize = 32;
    const hosts = [];

    for (let host = 1; host <= 254; host += 1) {
      const ip = `${network.prefix}${host}`;
      if (ip === network.address || lightsByIp.has(ip)) continue;
      hosts.push(ip);
    }

    for (let i = 0; i < hosts.length; i += batchSize) {
      const batch = hosts.slice(i, i + batchSize);
      const results = await Promise.all(batch.map((ip) => probeLight(ip)));

      for (const light of results) {
        if (light) lightsByIp.set(light.ip, light);
      }

      if (lightsByIp.size > 0) break;
    }

    if (lightsByIp.size > 0) break;
  }

  return [...lightsByIp.values()];
}

export function discoverLights() {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const lightsByIp = new Map();
    const broadcasts = getBroadcastAddresses();
    let sendTimer;
    let closeTimer;
    let rounds = 0;
    const maxRounds = Math.ceil(DISCOVERY_TIMEOUT_MS / DISCOVERY_SEND_INTERVAL_MS);

    const cleanup = () => {
      clearInterval(sendTimer);
      clearTimeout(closeTimer);
      try {
        socket.close();
      } catch {
        // already closed
      }
    };

    const finish = async () => {
      cleanup();
      let lights = [...lightsByIp.values()];

      if (lights.length === 0) {
        lights = await scanLocalSubnets(lights);
      }

      resolve(lights);
    };

    socket.on("error", (err) => {
      cleanup();
      reject(err);
    });

    socket.on("message", (data, rinfo) => {
      try {
        const response = JSON.parse(data.toString());
        const mac = response?.result?.mac ?? null;
        const state = response?.result?.state ?? null;

        if (!mac && response?.method !== "getPilot") return;

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

    const sendDiscoveryBurst = () => {
      for (const broadcast of broadcasts) {
        sendBroadcast(socket, GET_PILOT, broadcast);
        sendBroadcast(socket, REGISTRATION, broadcast);
      }
      rounds += 1;
      if (rounds >= maxRounds) {
        clearInterval(sendTimer);
      }
    };

    socket.bind(0, () => {
      socket.setBroadcast(true);

      sendDiscoveryBurst();
      sendTimer = setInterval(sendDiscoveryBurst, DISCOVERY_SEND_INTERVAL_MS);
      closeTimer = setTimeout(finish, DISCOVERY_TIMEOUT_MS + 250);
    });
  });
}

function sendUdp(message, targetHost, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    const payload = wizPayload(message);
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(value);
    };

    const timer = setTimeout(() => {
      finish({ success: true, note: "Command sent (no UDP ack)" });
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

    const sendOnce = () => {
      socket.send(payload, PORT, targetHost, (err) => {
        if (err) {
          settled = true;
          clearTimeout(timer);
          socket.close();
          reject(err);
        }
      });
    };

    sendOnce();
    setTimeout(sendOnce, 120);
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
    800
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
