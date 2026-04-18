/**
 * Profile Intelligence Service — Test Suite
 *
 * Tests every endpoint, every edge case, and every error condition.
 * Uses supertest to fire real HTTP requests against the live Express app.
 * External API calls are mocked so tests run offline and deterministically.
 */

const request = require("supertest");

// ─────────────────────────────────────────────────────────────────────────────
// Mock the enrichment module so tests never hit real external APIs.
// This keeps tests fast, deterministic, and offline.
// ─────────────────────────────────────────────────────────────────────────────
jest.mock("../src/enrichment", () => ({
  enrichName: jest.fn(),
}));

const { enrichName } = require("../src/enrichment");
const { resetDb } = require("../src/db");

// Mock the DB so each test starts with a clean, in-memory store
jest.mock("../src/db", () => {
  const initSqlJs = require("sql.js");
  let db;

  const SCHEMA = `
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      gender TEXT,
      gender_probability REAL,
      sample_size INTEGER,
      age INTEGER,
      age_group TEXT,
      country_id TEXT,
      country_probability REAL,
      created_at TEXT NOT NULL
    )
  `;

  const getDb = async () => {
    if (!db) {
      const SQL = await initSqlJs();
      db = new SQL.Database();
      db.run(SCHEMA);
    }
    return db;
  };

  // Expose a reset function tests can call in beforeEach
  const resetDb = async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    db.run(SCHEMA);
  };

  return { getDb, persist: jest.fn(), resetDb };
});

const app = require("../index");

// ─────────────────────────────────────────────────────────────────────────────
// Default enrichment mock data (most tests use "ella")
// ─────────────────────────────────────────────────────────────────────────────
const MOCK_ENRICHMENT = {
  gender: "female",
  gender_probability: 0.99,
  sample_size: 1234,
  age: 32,
  age_group: "adult",
  country_id: "NG",
  country_probability: 0.85,
};

beforeEach(async () => {
  await resetDb();                                    // fresh DB for every test
  enrichName.mockResolvedValue({ ...MOCK_ENRICHMENT });
});

afterEach(() => {
  jest.clearAllMocks();
});

// =============================================================================
// POST /api/profiles
// =============================================================================
describe("POST /api/profiles", () => {

  test("201 — creates a new profile with all required fields", async () => {
    const res = await request(app)
      .post("/api/profiles")
      .send({ name: "ella" });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("success");

    const d = res.body.data;
    expect(d.name).toBe("ella");
    expect(d.gender).toBe("female");
    expect(d.gender_probability).toBe(0.99);
    expect(d.sample_size).toBe(1234);
    expect(d.age).toBe(32);
    expect(d.age_group).toBe("adult");
    expect(d.country_id).toBe("NG");
    expect(d.country_probability).toBe(0.85);
    expect(d.id).toMatch(/^[0-9a-f-]{36}$/);           // UUID format
    expect(d.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601
  });

  test("201 — name is normalised to lowercase before storage", async () => {
    const res = await request(app)
      .post("/api/profiles")
      .send({ name: "ELLA" });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe("ella");
  });

  test("200 — idempotency: same name returns existing profile, not a new one", async () => {
    // First request — creates the profile
    await request(app).post("/api/profiles").send({ name: "ella" });

    // Second request — should NOT call external APIs again
    const res = await request(app)
      .post("/api/profiles")
      .send({ name: "ella" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.message).toBe("Profile already exists");
    expect(res.body.data.name).toBe("ella");

    // enrichName should only have been called once total
    expect(enrichName).toHaveBeenCalledTimes(1);
  });

  test("200 — idempotency is case-insensitive (ELLA matches ella)", async () => {
    await request(app).post("/api/profiles").send({ name: "ella" });
    const res = await request(app).post("/api/profiles").send({ name: "ELLA" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Profile already exists");
    expect(enrichName).toHaveBeenCalledTimes(1);
  });

  test("400 — missing name field", async () => {
    const res = await request(app)
      .post("/api/profiles")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.status).toBe("error");
  });

  test("400 — empty name string", async () => {
    const res = await request(app)
      .post("/api/profiles")
      .send({ name: "" });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe("error");
  });

  test("400 — whitespace-only name", async () => {
    const res = await request(app)
      .post("/api/profiles")
      .send({ name: "   " });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe("error");
  });

  test("422 — name is a number (wrong type)", async () => {
    const res = await request(app)
      .post("/api/profiles")
      .send({ name: 12345 });

    expect(res.status).toBe(422);
    expect(res.body.status).toBe("error");
  });

  test("422 — name is an array (wrong type)", async () => {
    const res = await request(app)
      .post("/api/profiles")
      .send({ name: ["ella"] });

    expect(res.status).toBe(422);
    expect(res.body.status).toBe("error");
  });

  test("502 — Genderize returns null gender", async () => {
    const err = new Error("Genderize returned an invalid response");
    err.status = 502;
    err.source = "Genderize";
    enrichName.mockRejectedValue(err);

    const res = await request(app)
      .post("/api/profiles")
      .send({ name: "xyzzy" });

    expect(res.status).toBe(502);
    expect(res.body.status).toBe("502");
    expect(res.body.message).toContain("Genderize");
  });

  test("502 — Agify returns null age", async () => {
    const err = new Error("Agify returned an invalid response");
    err.status = 502;
    err.source = "Agify";
    enrichName.mockRejectedValue(err);

    const res = await request(app)
      .post("/api/profiles")
      .send({ name: "xyzzy" });

    expect(res.status).toBe(502);
    expect(res.body.message).toContain("Agify");
  });

  test("502 — Nationalize returns no countries", async () => {
    const err = new Error("Nationalize returned an invalid response");
    err.status = 502;
    err.source = "Nationalize";
    enrichName.mockRejectedValue(err);

    const res = await request(app)
      .post("/api/profiles")
      .send({ name: "xyzzy" });

    expect(res.status).toBe(502);
    expect(res.body.message).toContain("Nationalize");
  });

});

// =============================================================================
// GET /api/profiles
// =============================================================================
describe("GET /api/profiles", () => {

  async function createProfile(name, overrides = {}) {
    enrichName.mockResolvedValueOnce({ ...MOCK_ENRICHMENT, ...overrides });
    await request(app).post("/api/profiles").send({ name });
  }

  test("200 — returns all profiles with trimmed schema (no gender_probability etc.)", async () => {
    await createProfile("ella");
    await createProfile("john", { gender: "male", country_id: "US", age_group: "teenager", age: 17 });

    const res = await request(app).get("/api/profiles");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.count).toBe(2);
    expect(res.body.data).toHaveLength(2);

    // List schema should NOT include sensitive probability fields
    const first = res.body.data[0];
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("name");
    expect(first).toHaveProperty("gender");
    expect(first).toHaveProperty("age");
    expect(first).toHaveProperty("age_group");
    expect(first).toHaveProperty("country_id");
    expect(first).not.toHaveProperty("gender_probability");
    expect(first).not.toHaveProperty("country_probability");
    expect(first).not.toHaveProperty("sample_size");
    expect(first).not.toHaveProperty("created_at");
  });

  test("200 — empty list when no profiles exist", async () => {
    const res = await request(app).get("/api/profiles");

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.data).toEqual([]);
  });

  test("200 — filter by gender=male", async () => {
    await createProfile("ella", { gender: "female" });
    await createProfile("john", { gender: "male" });
    await createProfile("lucas", { gender: "male" });

    const res = await request(app).get("/api/profiles?gender=male");

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    res.body.data.forEach((p) => expect(p.gender).toBe("male"));
  });

  test("200 — filter is case-insensitive (?gender=MALE matches male)", async () => {
    await createProfile("john", { gender: "male" });
    const res = await request(app).get("/api/profiles?gender=MALE");

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  test("200 — filter by country_id=NG", async () => {
    await createProfile("ella", { country_id: "NG" });
    await createProfile("john", { country_id: "US" });

    const res = await request(app).get("/api/profiles?country_id=NG");

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].country_id).toBe("NG");
  });

  test("200 — filter by age_group=senior", async () => {
    await createProfile("ella", { age_group: "adult", age: 30 });
    await createProfile("grandpa", { age_group: "senior", age: 72 });

    const res = await request(app).get("/api/profiles?age_group=senior");

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].age_group).toBe("senior");
  });

  test("200 — multiple filters combined (AND logic)", async () => {
    await createProfile("ella", { gender: "female", country_id: "NG", age_group: "adult" });
    await createProfile("john", { gender: "male",   country_id: "NG", age_group: "adult" });
    await createProfile("ama",  { gender: "female", country_id: "GH", age_group: "adult" });

    const res = await request(app).get("/api/profiles?gender=female&country_id=NG");

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].name).toBe("ella");
  });

});

// =============================================================================
// GET /api/profiles/:id
// =============================================================================
describe("GET /api/profiles/:id", () => {

  test("200 — returns full profile by ID", async () => {
    const created = await request(app)
      .post("/api/profiles")
      .send({ name: "ella" });

    const id = created.body.data.id;
    const res = await request(app).get(`/api/profiles/${id}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");

    const d = res.body.data;
    expect(d.id).toBe(id);
    expect(d.name).toBe("ella");
    // Full schema — all fields present
    expect(d).toHaveProperty("gender_probability");
    expect(d).toHaveProperty("sample_size");
    expect(d).toHaveProperty("country_probability");
    expect(d).toHaveProperty("created_at");
  });

  test("404 — unknown ID returns not found", async () => {
    const res = await request(app).get(
      "/api/profiles/00000000-0000-7000-8000-000000000000"
    );

    expect(res.status).toBe(404);
    expect(res.body.status).toBe("error");
    expect(res.body.message).toContain("not found");
  });

});

// =============================================================================
// DELETE /api/profiles/:id
// =============================================================================
describe("DELETE /api/profiles/:id", () => {

  test("204 — deletes profile, returns no body", async () => {
    const created = await request(app)
      .post("/api/profiles")
      .send({ name: "ella" });

    const id = created.body.data.id;
    const res = await request(app).delete(`/api/profiles/${id}`);

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
  });

  test("404 — trying to GET after delete returns 404", async () => {
    const created = await request(app)
      .post("/api/profiles")
      .send({ name: "ella" });

    const id = created.body.data.id;
    await request(app).delete(`/api/profiles/${id}`);

    const res = await request(app).get(`/api/profiles/${id}`);
    expect(res.status).toBe(404);
  });

  test("404 — deleting a non-existent ID returns 404", async () => {
    const res = await request(app).delete(
      "/api/profiles/00000000-0000-7000-8000-000000000000"
    );

    expect(res.status).toBe(404);
    expect(res.body.status).toBe("error");
  });

  test("after delete, same name can be re-created (not blocked by idempotency)", async () => {
    const first = await request(app).post("/api/profiles").send({ name: "ella" });
    const firstId = first.body.data.id;

    await request(app).delete(`/api/profiles/${firstId}`);

    // Re-create — should call enrichName again and get a new ID
    const second = await request(app).post("/api/profiles").send({ name: "ella" });

    expect(second.status).toBe(201);
    expect(second.body.data.id).not.toBe(firstId);
    expect(enrichName).toHaveBeenCalledTimes(2);
  });

});

// =============================================================================
// CORS headers
// =============================================================================
describe("CORS", () => {
  test("every response includes Access-Control-Allow-Origin: *", async () => {
    const res = await request(app).get("/api/profiles");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  test("OPTIONS preflight returns 204", async () => {
    const res = await request(app).options("/api/profiles");
    expect(res.status).toBe(204);
  });
});

// =============================================================================
// Age group classification
// =============================================================================
describe("Age group classification", () => {
  const cases = [
    [0,  "child"],
    [5,  "child"],
    [12, "child"],
    [13, "teenager"],
    [19, "teenager"],
    [20, "adult"],
    [59, "adult"],
    [60, "senior"],
    [90, "senior"],
  ];

  test.each(cases)("age %i → %s", async (age, expected_group) => {
    enrichName.mockResolvedValueOnce({ ...MOCK_ENRICHMENT, age, age_group: expected_group });

    const res = await request(app)
      .post("/api/profiles")
      .send({ name: `testname_${age}` });

    expect(res.body.data.age_group).toBe(expected_group);
  });
});