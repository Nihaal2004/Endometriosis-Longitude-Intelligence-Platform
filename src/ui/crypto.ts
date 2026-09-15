/**
 * crypto.ts — Local encryption at rest.
 *
 * Everything MedTrace stores lives in the browser's localStorage (see docs/PRIVACY.md)
 * — there is no server. This module is what turns "nothing leaves the device" into
 * "and what's on the device is not plaintext either": the persisted state is encrypted
 * with a key derived from a passphrase the user sets on first use, via the Web Crypto
 * API (PBKDF2 -> AES-GCM-256). No plaintext, no key, and no passphrase is ever written
 * to disk — only ciphertext, plus the random salt and IV needed to decrypt it, neither
 * of which is secret on its own.
 *
 * The honest limit, stated rather than buried: the passphrase lives only in memory for
 * the session (`setActivePassphrase`). There is no recovery path. A forgotten
 * passphrase means the locally stored data is unrecoverable by design — the same
 * property that makes it actually resistant to a stolen device also means there is no
 * "forgot password" email to send, because there is no server to send it from.
 */

const PBKDF2_ITERATIONS = 200_000
const SALT_BYTES = 16
const IV_BYTES = 12

function bufToB64(buf: Uint8Array): string {
  let binary = ''
  for (const byte of buf) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function b64ToBuf(b64: string): Uint8Array {
  const binary = atob(b64)
  const buf = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i)
  return buf
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export interface EncryptedBlob {
  salt: string
  iv: string
  data: string
}

/** Encrypts `plaintext` under a key derived from `passphrase`. Salt and IV are fresh every call. */
export async function encryptText(plaintext: string, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(passphrase, salt)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  )
  const blob: EncryptedBlob = {
    salt: bufToB64(salt),
    iv: bufToB64(iv),
    data: bufToB64(new Uint8Array(ciphertext)),
  }
  return JSON.stringify(blob)
}

/**
 * Decrypts a blob produced by `encryptText`. Throws (AES-GCM's authentication tag
 * check fails) if the passphrase is wrong or the data was tampered with — this is how
 * an incorrect passcode is detected, without storing any separate password hash.
 */
export async function decryptText(blobJson: string, passphrase: string): Promise<string> {
  const blob = JSON.parse(blobJson) as EncryptedBlob
  const key = await deriveKey(passphrase, b64ToBuf(blob.salt))
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBuf(blob.iv) as BufferSource },
    key,
    b64ToBuf(blob.data) as BufferSource,
  )
  return new TextDecoder().decode(plaintext)
}

/** True if `blobJson` looks like something `encryptText` produced (structural check only). */
export function looksEncrypted(blobJson: string | null): boolean {
  if (!blobJson) return false
  try {
    const parsed = JSON.parse(blobJson)
    return typeof parsed?.salt === 'string' && typeof parsed?.iv === 'string' && typeof parsed?.data === 'string'
  } catch {
    return false
  }
}
