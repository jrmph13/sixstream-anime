/**
 * Admin & API Key Management Module
 * 
 * Handles:
 * - API key generation and storage (encrypted child keys)
 * - Usage tracking per key (IP, User-Agent, endpoint, timestamp)
 * - Key banning/blocking
 * - Admin dashboard data
 */

const fs = require("fs");
const path = require("path");
const { generateApiKey, isValidKey } = require("./api-encrypt");

// Data file path
const DATA_DIR = path.join(__dirname, "admin-data");
const KEYS_FILE = path.join(DATA_DIR, "api-keys.json");
const LOGS_FILE = path.join(DATA_DIR, "usage-logs.json");
const BANNED_FILE = path.join(DATA_DIR, "banned-keys.json");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ── In-memory stores ──────────────────────────────────────────────────────────
let apiKeys = {};   // keyHash -> { label, created, key (partial), isAdmin, blocked }
let usageLogs = [];  // [{ keyHash, label, ip, ua, endpoint, time }]
let bannedKeys = []; // [{ keyHash, reason, bannedAt }]
const MAX_LOGS = 10000;

// ── Load from disk ────────────────────────────────────────────────────────────
function loadData() {
  try {
    if (fs.existsSync(KEYS_FILE)) {
      apiKeys = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
    }
  } catch (e) { console.warn("[admin] Failed to load api-keys:", e.message); }

  try {
    if (fs.existsSync(LOGS_FILE)) {
      usageLogs = JSON.parse(fs.readFileSync(LOGS_FILE, "utf8"));
    }
  } catch (e) { console.warn("[admin] Failed to load usage-logs:", e.message); }

  try {
    if (fs.existsSync(BANNED_FILE)) {
      bannedKeys = JSON.parse(fs.readFileSync(BANNED_FILE, "utf8"));
    }
  } catch (e) { console.warn("[admin] Failed to load banned-keys:", e.message); }
}

// ── Save to disk ──────────────────────────────────────────────────────────────
function saveKeys() {
  try {
    fs.writeFileSync(KEYS_FILE, JSON.stringify(apiKeys, null, 2));
  } catch (e) { console.error("[admin] Failed to save api-keys:", e.message); }
}

function saveLogs() {
  try {
    // Trim old logs
    if (usageLogs.length > MAX_LOGS) {
      usageLogs = usageLogs.slice(usageLogs.length - MAX_LOGS);
    }
    fs.writeFileSync(LOGS_FILE, JSON.stringify(usageLogs, null, 2));
  } catch (e) { console.error("[admin] Failed to save usage-logs:", e.message); }
}

function saveBanned() {
  try {
    fs.writeFileSync(BANNED_FILE, JSON.stringify(bannedKeys, null, 2));
  } catch (e) { console.error("[admin] Failed to save banned-keys:", e.message); }
}

// ── Initialize ────────────────────────────────────────────────────────────────
loadData();

// ── Admin verification ────────────────────────────────────────────────────────
function isAdminPass(input, masterPass) {
  return input === masterPass;
}

// ── Generate a new encrypted API key ──────────────────────────────────────────
function createApiKey(masterPass, label = "") {
  const key = generateApiKey(masterPass, label);
  const keyHash = simpleHash(key);
  
  // Store key info (never store the full key — just a hash for dedup)
  apiKeys[keyHash] = {
    label: label || "unnamed",
    created: Date.now(),
    keyPrefix: key.slice(0, 4) + "..." + key.slice(-4),
    isAdmin: false,
    blocked: false,
    fullKey: key, // Store full key so it can be displayed once on creation
  };
  saveKeys();
  
  return {
    key,
    label: label || "unnamed",
    hash: keyHash,
  };
}

// ── Simple hash for key storage ───────────────────────────────────────────────
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h = h & h; // Convert to 32bit integer
  }
  return Math.abs(h).toString(36);
}

// ── Check if a key is banned ──────────────────────────────────────────────────
function isKeyBanned(apiKey) {
  const keyHash = simpleHash(apiKey);
  return bannedKeys.some(b => b.keyHash === keyHash);
}

// ── Track API usage ───────────────────────────────────────────────────────────
function trackUsage(apiKey, req, masterPass) {
  const keyHash = simpleHash(apiKey);
  const keyInfo = apiKeys[keyHash];
  // Detect if this is the master admin password being used directly
  const isAdminKey = masterPass && apiKey === masterPass;
  const label = keyInfo ? keyInfo.label : (isAdminKey ? "admin" : "unknown");
  
  // Detect calling app/domain from headers
  const origin = req.headers["origin"] || "";
  const referer = req.headers["referer"] || "";
  const callingApp = origin || referer || "direct";
  
  // Detect if it's a known app/user-agent pattern
  const ua = (req.headers["user-agent"] || "unknown").slice(0, 120);
  let callerType = "browser";
  if (ua.includes("axios") || ua.includes("node-fetch") || ua.includes("got/") || ua.includes("Python") || ua.includes("curl")) {
    callerType = "script";
  }
  
  const logEntry = {
    keyHash,
    label,
    isAdmin: isAdminKey,
    callingApp,
    callerType,
    ip: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || req.connection?.remoteAddress || "unknown",
    ua,
    endpoint: req.path,
    time: Date.now(),
  };
  
  usageLogs.push(logEntry);
  
  // Auto-trim and save every 50 requests
  if (usageLogs.length % 50 === 0) {
    saveLogs();
  }
  
  return logEntry;
}

// ── Ban a key ─────────────────────────────────────────────────────────────────
function banKey(targetKey, reason = "No reason") {
  const keyHash = simpleHash(targetKey);
  
  // Remove from active keys
  delete apiKeys[keyHash];
  saveKeys();
  
  // Add to banned list
  bannedKeys.push({
    keyHash,
    reason,
    bannedAt: Date.now(),
  });
  saveBanned();
  
  return { success: true, keyHash, reason };
}

// ── Unban a key ───────────────────────────────────────────────────────────────
function unbanKey(keyHash) {
  const idx = bannedKeys.findIndex(b => b.keyHash === keyHash);
  if (idx >= 0) {
    bannedKeys.splice(idx, 1);
    saveBanned();
    return { success: true };
  }
  return { success: false, message: "Key not found in ban list" };
}

// ── Permanently delete a key ──────────────────────────────────────────────────
function deleteKey(keyHash) {
  if (apiKeys[keyHash]) {
    delete apiKeys[keyHash]; // Completely remove from stored keys
    saveKeys();
    return { success: true };
  }
  return { success: false, message: "Key not found" };
}

// ── Dashboard data ────────────────────────────────────────────────────────────
function getDashboardStats() {
  const totalKeys = Object.keys(apiKeys).length;
  const totalBanned = bannedKeys.length;
  
  // Recent usage (last 100)
  const recentLogs = usageLogs.slice(-100).reverse();
  
  // Unique IPs per key
  const keyUsage = {};
  for (const log of usageLogs) {
    if (!keyUsage[log.keyHash]) {
      keyUsage[log.keyHash] = {
        label: log.label,
        ips: new Set(),
        count: 0,
        lastAccess: 0,
        endpoints: new Set(),
      };
    }
    keyUsage[log.keyHash].ips.add(log.ip);
    keyUsage[log.keyHash].count++;
    keyUsage[log.keyHash].endpoints.add(log.endpoint);
    if (log.time > keyUsage[log.keyHash].lastAccess) {
      keyUsage[log.keyHash].lastAccess = log.time;
    }
  }
  
  // Convert Sets to arrays for JSON
  const keyStats = {};
  for (const [hash, data] of Object.entries(keyUsage)) {
    keyStats[hash] = {
      ...data,
      ips: [...data.ips],
      endpoints: [...data.endpoints],
    };
  }
  
  return {
    stats: {
      totalKeys,
      totalBanned,
      totalRequests: usageLogs.length,
      trackedIps: new Set(usageLogs.map(l => l.ip)).size,
    },
    keys: apiKeys,
    keyUsage: keyStats,
    bannedKeys: bannedKeys,
    recentLogs,
  };
}

// ── Extract API key from request ──────────────────────────────────────────────
function extractApiKey(req) {
  // 1. Query param
  if (req.query.apipass) return req.query.apipass;
  // 2. Header x-api-pass
  if (req.headers["x-api-pass"]) return req.headers["x-api-pass"];
  // 3. Authorization Bearer
  const auth = req.headers["authorization"];
  if (auth && auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }
  return null;
}

module.exports = {
  createApiKey,
  isKeyBanned,
  trackUsage,
  banKey,
  unbanKey,
  deleteKey,
  getDashboardStats,
  extractApiKey,
  isAdminPass,
  isValidKey,
  simpleHash,
};