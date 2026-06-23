/**
 * Local zero-knowledge source decrypt — the Node mirror of the frontend's
 * source-crypto envelope:
 *
 *   - AES-256-GCM; project key = 32 raw bytes (44-char base64).
 *   - Per-artifact 96-bit (12-byte) IV; the 16-byte GCM tag is APPENDED to the
 *     ciphertext (WebCrypto-native layout), so `subtle.decrypt` consumes the wire
 *     bytes with zero re-framing. No AAD.
 *   - keyFingerprint = first 8 hex chars of sha256(raw key bytes) — lets us say
 *     "wrong key" deterministically without the key ever leaving this process.
 *
 * The key is a function argument; it is never logged, never echoed, never put in
 * any return value. We hand back plaintext + fingerprints only.
 */
import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;

export function b64ToBytes(b64) {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

export function bytesToB64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

/** A project key is 32 raw bytes → exactly 44 base64 chars (`=`-padded). */
export function isValidProjectKey(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(key)) return false;
  try {
    return b64ToBytes(key).length === 32;
  } catch {
    return false;
  }
}

async function fingerprintOfRaw(raw) {
  const digest = await subtle.digest('SHA-256', raw);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 8);
}

/** First 8 hex of sha256(raw key bytes) — matches plugin + upload + dash wire. */
export async function fingerprintOfKey(keyB64) {
  return fingerprintOfRaw(b64ToBytes(keyB64));
}

/**
 * Decrypt one artifact: AES-256-GCM, appended-tag layout. Throws on a bad tag
 * (tampered ciphertext or — if the fingerprint check was skipped — a wrong key).
 * Callers MUST fingerprint-check first so a mismatch is a clean message, not a
 * raw GCM throw.
 */
export async function decryptArtifact(keyB64, ivB64, ciphertextB64) {
  const key = await subtle.importKey('raw', b64ToBytes(keyB64), 'AES-GCM', false, ['decrypt']);
  const plain = await subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(ivB64) },
    key,
    b64ToBytes(ciphertextB64),
  );
  return new TextDecoder().decode(plain);
}

/**
 * Encrypt helper — used ONLY by the test fixtures to mint ciphertext with the
 * exact pinned envelope (matches the plugin/frontend wire). Not used at runtime.
 */
export async function encryptArtifact(keyB64, plaintext, ivBytes) {
  const iv = ivBytes ?? webcrypto.getRandomValues(new Uint8Array(12));
  const key = await subtle.importKey('raw', b64ToBytes(keyB64), 'AES-GCM', false, ['encrypt']);
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { iv: bytesToB64(iv), ciphertext: bytesToB64(new Uint8Array(ct)) };
}
