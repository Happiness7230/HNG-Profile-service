const https = require("https");

/**
 * Simple HTTP GET helper — wraps Node's https module in a Promise.
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error("Invalid JSON from " + url));
          }
        });
      })
      .on("error", reject);
  });
}

/**
 * Call Genderize API — predicts gender from a name.
 * Returns: { gender, gender_probability, sample_size }
 * Throws 502 if gender is null or count is 0.
 */
async function fetchGender(name) {
  const data = await httpGet(`https://api.genderize.io?name=${encodeURIComponent(name)}`);

  // Edge case: Genderize can't determine gender (rare/unknown names)
  if (!data.gender || data.count === 0) {
    const err = new Error("Genderize returned an invalid response");
    err.status = 502;
    err.source = "Genderize";
    throw err;
  }

  return {
    gender: data.gender,
    gender_probability: data.probability,
    sample_size: data.count,       // renamed: "count" → "sample_size" per spec
  };
}

/**
 * Call Agify API — predicts age from a name.
 * Returns: { age, age_group }
 * Throws 502 if age is null.
 */
async function fetchAge(name) {
  const data = await httpGet(`https://api.agify.io?name=${encodeURIComponent(name)}`);

  if (data.age === null || data.age === undefined) {
    const err = new Error("Agify returned an invalid response");
    err.status = 502;
    err.source = "Agify";
    throw err;
  }

  // Classify age into groups per spec
  const age = data.age;
  let age_group;
  if (age <= 12)       age_group = "child";
  else if (age <= 19)  age_group = "teenager";
  else if (age <= 59)  age_group = "adult";
  else                 age_group = "senior";

  return { age, age_group };
}

/**
 * Call Nationalize API — predicts country from a name.
 * Returns: { country_id, country_probability }
 * Throws 502 if no country data.
 */
async function fetchCountry(name) {
  const data = await httpGet(`https://api.nationalize.io?name=${encodeURIComponent(name)}`);

  if (!data.country || data.country.length === 0) {
    const err = new Error("Nationalize returned an invalid response");
    err.status = 502;
    err.source = "Nationalize";
    throw err;
  }

  // Pick the country with the HIGHEST probability
  const top = data.country.reduce((best, c) =>
    c.probability > best.probability ? c : best
  );

  return {
    country_id: top.country_id,
    country_probability: top.probability,
  };
}

/**
 * Enrich a name by calling all three APIs concurrently (Promise.all).
 * Faster than sequential calls — all three fire at the same time.
 */
async function enrichName(name) {
  const [genderData, ageData, countryData] = await Promise.all([
    fetchGender(name),
    fetchAge(name),
    fetchCountry(name),
  ]);

  return { ...genderData, ...ageData, ...countryData };
}

module.exports = { enrichName };