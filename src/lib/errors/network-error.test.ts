import { describe, expect, it } from 'vitest'

import { isNetworkError } from './network-error'

describe('isNetworkError', () => {
  it('recognises a rejected fetch', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true)
  })

  it('recognises the plain error object supabase-js returns when offline', () => {
    // PostgREST, Storage and Functions clients catch the TypeError and return this.
    expect(isNetworkError({ message: 'TypeError: Failed to fetch', details: '', code: '' })).toBe(
      true,
    )
    expect(isNetworkError({ message: 'Load failed' })).toBe(true) // Safari
    expect(isNetworkError({ message: 'NetworkError when attempting to fetch resource.' })).toBe(
      true,
    ) // Firefox
    expect(
      isNetworkError({
        name: 'FunctionsFetchError',
        message: 'Failed to send a request to the Edge Function',
      }),
    ).toBe(true)
  })

  it('does not mistake server answers for network failures', () => {
    expect(isNetworkError({ code: '42501', message: 'permission denied for table meals' })).toBe(
      false,
    )
    expect(isNetworkError({ code: '23514', message: 'violates check constraint' })).toBe(false)
    expect(isNetworkError(new Error('Something else'))).toBe(false)
    expect(isNetworkError(null)).toBe(false)
  })
})
