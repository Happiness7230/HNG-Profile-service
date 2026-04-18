const express = require("express");
const router = express.Router();
const { getDb, persist } = require("../db");
const { enrichName } = require("../enrichment");
const { generateUUIDv7 } = require("../uuid");

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/profiles
//
// Flow:
//   1. Validate request body
//   2. Check if name already exists (idempotency)
//   3. If new: call all 3 external APIs concurrently
//   4. Store result with UUID v7 + UTC timestamp
//   5. Return 201 with the new profile
// ─────────────────────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const { name } = req.body;

    // ── Validation ────────────────────────────────────────────────────────────
    if (name === undefined || name === null || name === "") {
      return res.status(400).json({
        status: "error",
        message: "name is required",
      });
    }

    if (typeof name !== "string") {
      return res.status(422).json({
        status: "error",
        message: "name must be a string",
      });
    }

    const cleanName = name.trim().toLowerCase();

    if (!cleanName) {
      return res.status(400).json({
        status: "error",
        message: "name cannot be empty",
      });
    }

    const db = await getDb();

    // ── Idempotency check ─────────────────────────────────────────────────────
    // If we already have this name, return the existing record — don't re-call APIs
    const existing = db.exec(
      `SELECT * FROM profiles WHERE LOWER(name) = ?`,
      [cleanName]
    );

    if (existing.length > 0 && existing[0].values.length > 0) {
      const cols = existing[0].columns;
      const row = existing[0].values[0];
      const profile = Object.fromEntries(cols.map((c, i) => [c, row[i]]));

      return res.status(200).json({
        status: "success",
        message: "Profile already exists",
        data: formatProfile(profile),
      });
    }

    // ── Enrich via external APIs ──────────────────────────────────────────────
    const enriched = await enrichName(cleanName);

    // ── Build and store profile ───────────────────────────────────────────────
    const id = generateUUIDv7();
    const created_at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z"); // UTC ISO 8601

    db.run(
      `INSERT INTO profiles
        (id, name, gender, gender_probability, sample_size, age, age_group, country_id, country_probability, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        cleanName,
        enriched.gender,
        enriched.gender_probability,
        enriched.sample_size,
        enriched.age,
        enriched.age_group,
        enriched.country_id,
        enriched.country_probability,
        created_at,
      ]
    );

    persist(); // write DB to disk

    return res.status(201).json({
      status: "success",
      data: {
        id,
        name: cleanName,
        ...enriched,
        created_at,
      },
    });
  } catch (err) {
    // External API errors bubble up with err.status = 502
    if (err.status === 502) {
      return res.status(502).json({
        status: "502",
        message: err.message,
      });
    }

    console.error("POST /profiles error:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/profiles
//
// Returns ALL profiles with optional case-insensitive filtering by:
//   ?gender=male&country_id=NG&age_group=adult
//
// Note: The list response uses a TRIMMED schema (no gender_probability, etc.)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const { gender, country_id, age_group } = req.query;

    const db = await getDb();

    // Build WHERE clause dynamically based on which filters were provided
    const conditions = [];
    const params = [];

    if (gender) {
      conditions.push("LOWER(gender) = LOWER(?)");
      params.push(gender);
    }
    if (country_id) {
      conditions.push("LOWER(country_id) = LOWER(?)");
      params.push(country_id);
    }
    if (age_group) {
      conditions.push("LOWER(age_group) = LOWER(?)");
      params.push(age_group);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = db.exec(`SELECT * FROM profiles ${where} ORDER BY created_at DESC`, params);

    const profiles = [];
    if (result.length > 0) {
      const cols = result[0].columns;
      for (const row of result[0].values) {
        const profile = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
        profiles.push(formatProfileList(profile));
      }
    }

    return res.status(200).json({
      status: "success",
      count: profiles.length,
      data: profiles,
    });
  } catch (err) {
    console.error("GET /profiles error:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/profiles/:id
//
// Fetch a single profile by UUID.
// Returns 404 if not found.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const db = await getDb();

    const result = db.exec(`SELECT * FROM profiles WHERE id = ?`, [id]);

    if (!result.length || !result[0].values.length) {
      return res.status(404).json({
        status: "error",
        message: "Profile not found",
      });
    }

    const cols = result[0].columns;
    const row = result[0].values[0];
    const profile = Object.fromEntries(cols.map((c, i) => [c, row[i]]));

    return res.status(200).json({
      status: "success",
      data: formatProfile(profile),
    });
  } catch (err) {
    console.error("GET /profiles/:id error:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/profiles/:id
//
// Delete a profile by UUID.
// Returns 204 No Content on success, 404 if not found.
// ─────────────────────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const db = await getDb();

    // Check it exists first so we can return 404 if not
    const existing = db.exec(`SELECT id FROM profiles WHERE id = ?`, [id]);
    if (!existing.length || !existing[0].values.length) {
      return res.status(404).json({
        status: "error",
        message: "Profile not found",
      });
    }

    db.run(`DELETE FROM profiles WHERE id = ?`, [id]);
    persist(); // write updated DB to disk

    return res.status(204).send(); // No Content — no body on delete
  } catch (err) {
    console.error("DELETE /profiles/:id error:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — format DB rows into the exact response shapes the spec requires
// ─────────────────────────────────────────────────────────────────────────────

/** Full profile shape (POST + GET by id) */
function formatProfile(p) {
  return {
    id: p.id,
    name: p.name,
    gender: p.gender,
    gender_probability: p.gender_probability,
    sample_size: p.sample_size,
    age: p.age,
    age_group: p.age_group,
    country_id: p.country_id,
    country_probability: p.country_probability,
    created_at: p.created_at,
  };
}

/** Trimmed profile shape (GET list) */
function formatProfileList(p) {
  return {
    id: p.id,
    name: p.name,
    gender: p.gender,
    age: p.age,
    age_group: p.age_group,
    country_id: p.country_id,
  };
}

module.exports = router;