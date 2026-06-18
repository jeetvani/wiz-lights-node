import { discoverLights, hexToRgb, setColor } from "./wiz.js";

const [command, ip, hex] = process.argv.slice(2);

if (command === "discover") {
  const lights = await discoverLights();
  if (lights.length === 0) {
    console.log("No lights found.");
    process.exit(1);
  }

  for (const light of lights) {
    const onOff = light.state ? "on" : "off";
    console.log(`${light.ip}  mac=${light.mac ?? "?"}  state=${onOff}`);
  }
} else if (command === "color" && ip && hex) {
  const { r, g, b } = hexToRgb(hex);
  const result = await setColor(ip, r, g, b);
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Usage:
  npm run discover
  node src/cli.js discover
  node src/cli.js color <ip> <#hex>`);
  process.exit(1);
}
