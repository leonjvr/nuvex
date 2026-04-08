import express from "express";
import { connectToWhatsApp, startActionPoller, getGroups } from "./bot.js";

const app = express();
const PORT = parseInt(process.env.GATEWAY_WA_PORT || "8101", 10);

let connected = false;

app.get("/health", (_req, res) => {
  res.json({ status: "ok", whatsapp: connected ? "connected" : "connecting" });
});

app.get("/groups", async (_req, res) => {
  const groups = await getGroups();
  res.json(groups);
});

async function main() {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`WA gateway health on :${PORT}`);
  });

  try {
    await connectToWhatsApp();
    connected = true;
    startActionPoller();
  } catch (err) {
    console.error("Fatal WA connection error:", err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
