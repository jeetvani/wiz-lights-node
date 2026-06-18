import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { discoverLights, hexToRgb, setColor } from "./wiz.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

app.get("/api/discover", async (_req, res) => {
  try {
    const lights = await discoverLights();
    res.json({ success: true, lights });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/color", async (req, res) => {
  try {
    const { ip, hex, brightness = 100 } = req.body;

    if (!ip || !hex) {
      return res.status(400).json({
        success: false,
        error: "Provide ip and hex (e.g. #ff0044)",
      });
    }

    const { r, g, b } = hexToRgb(hex);
    const dimming = Math.max(10, Math.min(100, Number(brightness) || 100));
    const result = await setColor(ip, r, g, b, dimming);

    res.json({
      success: true,
      ip,
      color: { r, g, b, dimming, hex },
      result,
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Wiz lights UI: http://localhost:${PORT}`);
});
