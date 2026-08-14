import express from "express";
import cors from "cors";
import http from "http";
import multer from "multer";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import { intersectBearings } from "./triangulate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../dashboard/public")));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// In-memory store — fine for a PoC demo, swap for a real DB before any operational use.
const reports = []; // { id, officerId, lat, lon, bearingDeg, timestampMs, videoUrl }
const media = new Map(); // id -> { buffer, mimeType }
const SIGHTING_WINDOW_MS = 60_000; // reports within 60s of each other are treated as the same sighting

let nextId = 1;

function groupIntoSightings() {
  const sorted = [...reports].sort((a, b) => a.timestampMs - b.timestampMs);
  const groups = [];
  for (const r of sorted) {
    const last = groups[groups.length - 1];
    if (last && r.timestampMs - last[last.length - 1].timestampMs <= SIGHTING_WINDOW_MS) {
      last.push(r);
    } else {
      groups.push([r]);
    }
  }
  return groups;
}

function computeFixes() {
  const groups = groupIntoSightings();
  const fixes = [];
  for (const group of groups) {
    if (group.length < 2) continue;
    // Pair up every distinct officer combination in the group and average the fixes.
    const pairFixes = [];
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        if (a.officerId === b.officerId) continue;
        const fix = intersectBearings(
          { lat: a.lat, lon: a.lon }, a.bearingDeg,
          { lat: b.lat, lon: b.lon }, b.bearingDeg
        );
        if (fix) pairFixes.push({ ...fix, from: [a.officerId, b.officerId] });
      }
    }
    if (pairFixes.length > 0) {
      const lat = pairFixes.reduce((s, f) => s + f.lat, 0) / pairFixes.length;
      const lon = pairFixes.reduce((s, f) => s + f.lon, 0) / pairFixes.length;
      const bestConfidence = pairFixes.some((f) => f.confidence === "good")
        ? "good"
        : pairFixes.some((f) => f.confidence === "marginal") ? "marginal" : "low";
      fixes.push({
        sightingReports: group.map((r) => r.id),
        lat, lon,
        confidence: bestConfidence,
        pairFixes,
        timestampMs: group[group.length - 1].timestampMs,
      });
    }
  }
  return fixes;
}

function broadcastState() {
  io.emit("state", { reports, fixes: computeFixes() });
}

app.post("/report", upload.single("video"), (req, res) => {
  const { officerId, timestampMs } = req.body || {};
  const lat = Number(req.body?.lat);
  const lon = Number(req.body?.lon);
  const bearingDeg = Number(req.body?.bearingDeg);
  if (
    typeof officerId !== "string" ||
    !Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(bearingDeg)
  ) {
    return res.status(400).json({ error: "officerId, lat, lon, bearingDeg are required" });
  }
  const id = nextId++;
  if (req.file) {
    media.set(id, { buffer: req.file.buffer, mimeType: req.file.mimetype || "video/mp4" });
  }
  const report = {
    id,
    officerId,
    lat, lon, bearingDeg,
    timestampMs: Number.isFinite(Number(timestampMs)) ? Number(timestampMs) : Date.now(),
    videoUrl: req.file ? `/media/${id}/video` : null,
  };
  reports.push(report);
  broadcastState();
  res.json({ ok: true, id: report.id });
});

app.get("/media/:id/video", (req, res) => {
  const entry = media.get(Number(req.params.id));
  if (!entry) return res.status(404).end();
  res.setHeader("Content-Type", entry.mimeType);
  res.end(entry.buffer);
});

app.get("/state", (_req, res) => {
  res.json({ reports, fixes: computeFixes() });
});

app.post("/reset", (_req, res) => {
  reports.length = 0;
  media.clear();
  broadcastState();
  res.json({ ok: true });
});

io.on("connection", (socket) => {
  socket.emit("state", { reports, fixes: computeFixes() });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Drone sighting server listening on :${PORT}`);
});
