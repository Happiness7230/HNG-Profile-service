const express = require("express");
const app = express();

// ─────────────────────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────────────────────

// CORS — required by the grading script so it can reach this server
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204); // preflight
  next();
});

// Parse JSON bodies
app.use(express.json());

// Handle case where body has wrong Content-Type and JSON.parse fails
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(422).json({
      status: "error",
      message: "Invalid JSON body",
    });
  }
  next(err);
});

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────
const profilesRouter = require("./src/routes/profiles");
app.use("/api/profiles", profilesRouter);

// 404 fallback for unknown routes
app.use((req, res) => {
  res.status(404).json({ status: "error", message: "Route not found" });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ status: "error", message: "Internal server error" });
});

// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Profile Intelligence Service running on port ${PORT}`);
  console.log(`   POST   /api/profiles         — create a profile`);
  console.log(`   GET    /api/profiles          — list all (with optional filters)`);
  console.log(`   GET    /api/profiles/:id      — get one by ID`);
  console.log(`   DELETE /api/profiles/:id      — delete by ID\n`);
});

module.exports = app;