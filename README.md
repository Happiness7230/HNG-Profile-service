# Profile Intelligence Service

A REST API that accepts a name, enriches it using three free public APIs (gender, age, nationality), persists the result, and exposes endpoints to query and manage the stored profiles.

---

## Stack

- **Runtime**: Node.js
- **Framework**: Express
- **Database**: SQLite (via sql.js — pure JavaScript, no native binaries)
- **IDs**: UUID v7 (time-ordered, sortable)
- **Tests**: Jest + Supertest (36 tests, all passing)

---

## Setup

```bash
npm install
npm start          # → http://localhost:3000
npm test           # run full test suite
```

---

## Endpoints

### `POST /api/profiles`
Accepts a name, enriches it via external APIs, and stores the result.

**Idempotent** — submitting the same name twice returns the existing record without calling external APIs again.

```bash
curl -X POST http://localhost:3000/api/profiles \
  -H "Content-Type: application/json" \
  -d '{"name": "emma"}'
```

**201 Created** (new profile):
```json
{
  "status": "success",
  "data": {
    "id": "019d9ce5-2d69-7b72-9b86-e793a40f7762",
    "name": "emma",
    "gender": "female",
    "gender_probability": 0.99,
    "sample_size": 12345,
    "age": 32,
    "age_group": "adult",
    "country_id": "NG",
    "country_probability": 0.85,
    "created_at": "2026-04-17T12:00:00Z"
  }
}
```

**200 OK** (already exists):
```json
{
  "status": "success",
  "message": "Profile already exists",
  "data": { "...same profile..." }
}
```

---

### `GET /api/profiles`
Returns all stored profiles. Supports optional case-insensitive filters.

```bash
# All profiles
curl http://localhost:3000/api/profiles

# Filter by gender
curl "http://localhost:3000/api/profiles?gender=female"

# Filter by country
curl "http://localhost:3000/api/profiles?country_id=NG"

# Filter by age group
curl "http://localhost:3000/api/profiles?age_group=adult"

# Combine filters (AND logic)
curl "http://localhost:3000/api/profiles?gender=male&country_id=NG"
```

**200 OK**:
```json
{
  "status": "success",
  "count": 2,
  "data": [
    { "id": "...", "name": "emma", "gender": "female", "age": 32, "age_group": "adult", "country_id": "NG" },
    { "id": "...", "name": "john", "gender": "male",   "age": 25, "age_group": "adult", "country_id": "US" }
  ]
}
```

---

### `GET /api/profiles/:id`
Fetch a single profile by its UUID.

```bash
curl http://localhost:3000/api/profiles/019d9ce5-2d69-7b72-9b86-e793a40f7762
```

**200 OK** — full profile with all fields including probabilities and `created_at`.
**404** — profile not found.

---

### `DELETE /api/profiles/:id`
Permanently delete a profile.

```bash
curl -X DELETE http://localhost:3000/api/profiles/019d9ce5-2d69-7b72-9b86-e793a40f7762
```

**204 No Content** — success, no body.
**404** — profile not found.

---

## Age Group Classification

| Age range | Group      |
|-----------|------------|
| 0–12      | child      |
| 13–19     | teenager   |
| 20–59     | adult      |
| 60+       | senior     |

---

## Error Responses

All errors follow the same shape:
```json
{ "status": "error", "message": "<description>" }
```

| Code | Cause |
|------|-------|
| 400  | Missing or empty `name` |
| 404  | Profile ID not found |
| 422  | `name` is not a string |
| 502  | An external API returned invalid data (null gender, null age, or no country) |
| 500  | Unexpected server error |

External API 502 errors use `"status": "502"` per spec:
```json
{ "status": "502", "message": "Genderize returned an invalid response" }
```

---

## External APIs

All three are called **concurrently** via `Promise.all` for minimum latency:

| API | URL | Used for |
|-----|-----|---------|
| Genderize | `https://api.genderize.io?name={name}` | gender, probability, sample size |
| Agify | `https://api.agify.io?name={name}` | age |
| Nationalize | `https://api.nationalize.io?name={name}` | top country by probability |

---

## Project Structure

```
profile-service/
├── index.js                   # Express app — CORS, middleware, route mounting, server start
├── src/
│   ├── db.js                  # SQLite initialisation and disk persistence
│   ├── enrichment.js          # Calls all 3 external APIs and aggregates results
│   ├── uuid.js                # UUID v7 generator (timestamp-ordered)
│   └── routes/
│       └── profiles.js        # All 4 route handlers
└── tests/
    └── profiles.test.js       # 36 tests covering all endpoints and edge cases
```

---

## CORS

All responses include `Access-Control-Allow-Origin: *` so cross-origin clients (including the grading script) can reach the API.