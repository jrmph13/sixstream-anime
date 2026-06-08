/**
 * Custom API Key Encryption Module
 * 
 * Proprietary algorithm — not standard crypto.
 * Generates unique encrypted keys from the master password.
 * Each key is tied to the master but looks completely different.
 * Used to prevent `apipass=jrmphpogi ko13aila` from being detected/banned.
 */

// Master key signature — used to validate generated keys
const MASTER_SALT = "6stream_jhames_2024";
const KEY_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Custom hash function — transforms a string into a numeric seed.
 * Not SHA/MD5 — this is proprietary mixing.
 */
function customHash(input) {
  let h = 7;
  const prime = 171;
  for (let i = 0; i < input.length; i++) {
    h = (h * prime + input.charCodeAt(i)) % 2147483647;
  }
  return h;
}

/**
 * Generate a seeded pseudo-random number (0 to 1)
 */
function seededRandom(seed) {
  seed = (seed * 1664525 + 1013904223) % 2147483648;
  return { value: seed / 2147483648, nextSeed: seed };
}

/**
 * Custom substitution cipher — maps digits/letters to different ones
 * based on a seed, making it non-reversible without the algorithm.
 */
function customSubstitute(input, seed) {
  let result = "";
  let s = seed;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const { value, nextSeed } = seededRandom(s + i * 37);
    s = nextSeed;
    const shift = Math.floor(value * KEY_CHARS.length);
    const idx = KEY_CHARS.indexOf(char);
    if (idx >= 0) {
      const newIdx = (idx + shift) % KEY_CHARS.length;
      result += KEY_CHARS[newIdx];
    } else {
      result += char;
    }
  }
  return result;
}

/**
 * Encrypt/Generate an API key from the master password.
 * @param {string} masterPass - The master admin password
 * @param {string} label - A label/identifier for tracking (e.g., "user_app", "friend_website")
 * @returns {string} - Encrypted API key
 */
function generateApiKey(masterPass, label = "") {
  const masterHash = customHash(masterPass + MASTER_SALT);
  const labelHash = customHash(label + Date.now().toString());
  const combinedSalt = Math.abs(masterHash * labelHash).toString();
  
  // Create a base string from the combined salt
  let base = "";
  let s = masterHash + labelHash;
  for (let i = 0; i < 16; i++) {
    const { value, nextSeed } = seededRandom(s);
    s = nextSeed;
    base += KEY_CHARS[Math.floor(value * KEY_CHARS.length)];
  }
  
  // Apply custom substitution
  const encrypted = customSubstitute(base, masterHash);
  
  // Add a 4-char checksum derived from the master
  const checkSeed = customHash(encrypted + masterPass);
  let checksum = "";
  let cs = checkSeed;
  for (let i = 0; i < 4; i++) {
    const { value, nextSeed } = seededRandom(cs + i * 13);
    cs = nextSeed;
    checksum += KEY_CHARS[Math.floor(value * KEY_CHARS.length)];
  }
  
  return encrypted + checksum;
}

/**
 * Verify if an API key was generated from the master password.
 * @param {string} apiKey - The encrypted key to verify
 * @param {string} masterPass - The master admin password
 * @returns {boolean} - Whether the key is valid
 */
function verifyApiKey(apiKey, masterPass) {
  if (!apiKey || !masterPass) return false;
  if (apiKey.length < 4) return false;
  
  const keyBody = apiKey.slice(0, -4);
  const expectedChecksum = apiKey.slice(-4);
  
  // Recompute checksum
  const checkSeed = customHash(keyBody + masterPass);
  let computedChecksum = "";
  let cs = checkSeed;
  for (let i = 0; i < 4; i++) {
    const { value, nextSeed } = seededRandom(cs + i * 13);
    cs = nextSeed;
    computedChecksum += KEY_CHARS[Math.floor(value * KEY_CHARS.length)];
  }
  
  return computedChecksum === expectedChecksum;
}

/**
 * Verify if a key is either the exact master password OR a valid encrypted child key.
 */
function isValidKey(input, masterPass) {
  if (!input || !masterPass) return false;
  // Direct master password match
  if (input === masterPass) return true;
  // Encrypted child key
  if (verifyApiKey(input, masterPass)) return true;
  return false;
}

module.exports = {
  generateApiKey,
  verifyApiKey,
  isValidKey,
};