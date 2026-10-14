import { describe, expect, it } from 'vitest'
import { parseAuthCallback } from './platform'

describe('auth deep links', () => {
  it('extracts the PKCE code from the app callback', () => {
    expect(parseAuthCallback('com.medtrace.app://auth/callback?code=abc-123')).toEqual({ code: 'abc-123', error: undefined })
  })

  it('surfaces an error from an expired or reused link', () => {
    const r = parseAuthCallback('com.medtrace.app://auth/callback?error=access_denied&error_description=Email+link+is+invalid+or+has+expired')
    expect(r.error).toBe('Email link is invalid or has expired')
    expect(r.code).toBeUndefined()
  })

  it('ignores links that are not the auth callback', () => {
    expect(parseAuthCallback('https://example.com/?code=stolen')).toEqual({})
    expect(parseAuthCallback('com.medtrace.app://other?code=x')).toEqual({})
  })
})
