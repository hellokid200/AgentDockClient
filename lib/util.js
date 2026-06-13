import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import nacl from 'tweetnacl';
import tweetnaclUtil from 'tweetnacl-util';
const { encodeBase64, decodeBase64 } = tweetnaclUtil;

// ─── Configuration ─────────────────────────────
const CONFIG_DIR = join(homedir(), '.adclient');
const CREDENTIALS_FILE = join(CONFIG_DIR, 'credentials.json');

function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
}

export function loadCredentials() {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf-8'));
  } catch { return null; }
}

export function saveCredentials(creds) {
  ensureConfigDir();
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), 'utf-8');
}

// ─── HTTP ───────────────────────────────────────
const DEFAULT_TIMEOUT = 15000;

export async function httpRequest(method, url, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (opts.token) headers['Authorization'] = 'Bearer ' + opts.token;
  const body = opts.body ? JSON.stringify(opts.body) : undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout || DEFAULT_TIMEOUT);
  try {
    const r = await fetch(url, { method, headers, body, signal: controller.signal });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error?.message || data?.detail || `HTTP ${r.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function get(url, opts) { return httpRequest('GET', url, opts); }
export async function post(url, body, opts) { return httpRequest('POST', url, { ...opts, body }); }

// ─── Crypto ─────────────────────────────────────
export function generateKeyPair() {
  return nacl.box.keyPair();
}

export function generateMasterKey() {
  const key = nacl.randomBytes(32);
  return encodeBase64(key);
}

export function boxEncrypt(plaintextB64, theirPublicKeyB64) {
  const theirPk = decodeBase64(theirPublicKeyB64);
  const msg = decodeBase64(plaintextB64);
  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const ciphertext = nacl.box(msg, nonce, theirPk, ephemeral.secretKey);
  if (!ciphertext) throw new Error('box encrypt failed');
  const result = new Uint8Array(ephemeral.publicKey.length + nonce.length + ciphertext.length);
  result.set(ephemeral.publicKey, 0);
  result.set(nonce, ephemeral.publicKey.length);
  result.set(ciphertext, ephemeral.publicKey.length + nonce.length);
  return encodeBase64(result);
}

export function signChallenge(nonceB64, secretKeyB64) {
  const nonce = decodeBase64(nonceB64);
  const seed = decodeBase64(secretKeyB64);
  // Use NaCl sign keypair from seed (Ed25519 via tweetnacl)
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  const signature = nacl.sign.detached(nonce, keyPair.secretKey);
  return {
    signature: encodeBase64(signature),
    publicKey: encodeBase64(keyPair.publicKey),
  };
}
