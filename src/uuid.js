/**
 * UUID v7 Generator
 *
 * UUID v7 is time-ordered: the first 48 bits are a Unix timestamp in ms.
 * This makes them sortable by creation time — great for database primary keys.
 *
 * Structure: tttttttt-tttt-7xxx-yxxx-xxxxxxxxxxxx
 *   - t = timestamp bits
 *   - 7 = version
 *   - x = random bits
 *   - y = variant bits
 */
function generateUUIDv7() {
  const now = Date.now(); // milliseconds since Unix epoch

  // 48-bit timestamp
  const timestampHex = now.toString(16).padStart(12, "0");

  // Random bytes for the rest
  const rand = () => Math.floor(Math.random() * 16).toString(16);
  const rand4 = () => Array.from({ length: 4 }, rand).join("");
  const rand3 = () => Array.from({ length: 3 }, rand).join("");
  const rand12 = () => Array.from({ length: 12 }, rand).join("");

  // Version 7 = 0111 in top 4 bits of 7th byte
  const ver = "7";
  const randA = rand3(); // 12 bits random

  // Variant = 10xx in top 2 bits of 9th byte
  const variantByte = (8 + Math.floor(Math.random() * 4)).toString(16); // 8-b
  const randB = rand3(); // remaining 12 bits of clock_seq

  const randC = rand12(); // node

  // Format: 8-4-4-4-12
  const p1 = timestampHex.slice(0, 8);           // 32 bits of timestamp
  const p2 = timestampHex.slice(8, 12);           // 16 bits of timestamp
  const p3 = ver + randA;                          // version + 12 random bits
  const p4 = variantByte + randB;                  // variant + 12 random bits
  const p5 = randC;                                // 48 random bits

  return `${p1}-${p2}-${p3}-${p4}-${p5}`;
}

module.exports = { generateUUIDv7 };