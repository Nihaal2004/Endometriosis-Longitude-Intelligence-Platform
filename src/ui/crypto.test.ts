/**
 * crypto.test.ts — Gate for local encryption at rest.
 *
 * The property that actually matters for a "protects the patient's data" claim is not
 * just "decrypt(encrypt(x)) === x" — it's that a wrong passphrase is rejected rather
 * than silently returning garbage or, worse, plausible-looking wrong data, and that
 * the ciphertext itself doesn't leak structure (identical plaintext twice must not
 * produce identical ciphertext).
 */

import { describe, expect, it } from 'vitest'
import { decryptText, encryptText, looksEncrypted } from './crypto'

describe('encryptText / decryptText', () => {
  it('round-trips plaintext through the correct passphrase', async () => {
    const plaintext = JSON.stringify({ hello: 'world', days: [1, 2, 3] })
    const blob = await encryptText(plaintext, 'correct horse battery staple')
    const recovered = await decryptText(blob, 'correct horse battery staple')
    expect(recovered).toBe(plaintext)
  })

  it('rejects the wrong passphrase rather than returning garbage silently', async () => {
    const blob = await encryptText('sensitive patient text', 'right-passphrase')
    await expect(decryptText(blob, 'wrong-passphrase')).rejects.toThrow()
  })

  it('produces different ciphertext for identical plaintext (fresh salt/IV per call)', async () => {
    const blobA = await encryptText('same message', 'a-passphrase')
    const blobB = await encryptText('same message', 'a-passphrase')
    expect(blobA).not.toBe(blobB)
    // Both still decrypt correctly despite differing ciphertext.
    expect(await decryptText(blobA, 'a-passphrase')).toBe('same message')
    expect(await decryptText(blobB, 'a-passphrase')).toBe('same message')
  })

  it('never embeds the plaintext or passphrase in the stored blob', async () => {
    const blob = await encryptText('a very specific secret phrase', 'my-passcode-123')
    expect(blob).not.toContain('a very specific secret phrase')
    expect(blob).not.toContain('my-passcode-123')
  })

  it('handles an empty-string plaintext (a brand-new, never-logged record)', async () => {
    const blob = await encryptText('', 'some-passphrase')
    expect(await decryptText(blob, 'some-passphrase')).toBe('')
  })
})

describe('looksEncrypted', () => {
  it('recognises a real encrypted blob', async () => {
    const blob = await encryptText('x', 'p')
    expect(looksEncrypted(blob)).toBe(true)
  })

  it('rejects null, plain JSON, and garbage', () => {
    expect(looksEncrypted(null)).toBe(false)
    expect(looksEncrypted('{"personaId":"maya"}')).toBe(false)
    expect(looksEncrypted('not even json')).toBe(false)
  })
})
