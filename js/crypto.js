// Encryption for sync. Everything that leaves this device is sealed here
// first, so the data repo on GitHub only ever holds scrambled files.
//
// How it works:
// - Josh's passphrase is turned into a key with PBKDF2 (SHA-256, 600,000
//   rounds, the current OWASP figure) and a random salt kept in the repo.
// - Each file is compressed, then sealed with AES-GCM using a fresh random
//   12-byte IV. AES-GCM also detects any change to a sealed file.
// - The key is made once per device and kept on the device as a
//   non-extractable CryptoKey, so it can be used but never read back out.
//   The passphrase itself is never stored anywhere.

export const KDF_ITERATIONS = 600000;
const MAGIC = new TextEncoder().encode('TMB1'); // marks a sealed timeable file, version 1
const IV_BYTES = 12;
const TAG_BYTES = 16;
const CHECK_TEXT = 'timeable-sync-key-check';

// The passphrase didn't unlock a file (wrong passphrase, or the file was
// changed by something other than timeable).
export class WrongKeyError extends Error {
  constructor(message = 'That passphrase doesn’t unlock this sync.') { super(message); }
}

export class DamagedFileError extends Error {
  constructor(message = 'A sync file isn’t in timeable’s format.') { super(message); }
}

// The same passphrase must give the same key on every device. NFC makes
// accented letters typed on different keyboards match, and spaces at either
// end are ignored.
export function normalizePassphrase(passphrase) {
  return String(passphrase ?? '').normalize('NFC').trim();
}

export function newSalt() {
  return crypto.getRandomValues(new Uint8Array(16));
}

export async function deriveKey(passphrase, salt, iterations = KDF_ITERATIONS) {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(normalizePassphrase(passphrase)), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['encrypt', 'decrypt'],
  );
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

async function transform(bytes, stream) {
  const piped = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

const gzip = (bytes) => transform(bytes, new CompressionStream('gzip'));
const gunzip = (bytes) => transform(bytes, new DecompressionStream('gzip'));

// Sealed layout: "TMB1" (4 bytes) | IV (12 bytes) | ciphertext with tag.
// The marker is also bound in as additional data, so it can't be swapped.
export async function seal(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: MAGIC }, key, bytes);
  return concat(MAGIC, iv, new Uint8Array(sealed));
}

export async function unseal(key, data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < MAGIC.length + IV_BYTES + TAG_BYTES || MAGIC.some((b, i) => bytes[i] !== b)) {
    throw new DamagedFileError();
  }
  const iv = bytes.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  const body = bytes.subarray(MAGIC.length + IV_BYTES);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: MAGIC }, key, body));
  } catch {
    throw new WrongKeyError();
  }
}

export async function sealJson(key, value) {
  return seal(key, await gzip(new TextEncoder().encode(JSON.stringify(value))));
}

export async function unsealJson(key, data) {
  const opened = await unseal(key, data);
  try {
    return JSON.parse(new TextDecoder().decode(await gunzip(opened)));
  } catch {
    throw new DamagedFileError();
  }
}

// A small sealed value stored next to the salt, so a device can tell
// right away whether a passphrase is the right one.
export async function makeCheck(key) {
  return toBase64(await seal(key, new TextEncoder().encode(CHECK_TEXT)));
}

export async function checkMatches(key, check) {
  try {
    const opened = await unseal(key, fromBase64(check));
    return new TextDecoder().decode(opened) === CHECK_TEXT;
  } catch {
    return false;
  }
}

// Base64 for bytes. Built in chunks so large files don't overflow the call
// stack.
export function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(text) {
  const binary = atob(String(text).replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Sync needs these browser features. Older browsers get a plain message
// instead of a confusing failure.
export function cryptoSupported() {
  return Boolean(globalThis.crypto && crypto.subtle && typeof CompressionStream === 'function'
    && typeof DecompressionStream === 'function');
}
