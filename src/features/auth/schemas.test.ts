import { describe, expect, it } from 'vitest'

import { loginSchema, pinSchema } from './schemas'

describe('pinSchema', () => {
  it.each(['1234', '0000', '5821'])('accepts %s', (pin) => {
    expect(pinSchema.safeParse(pin).success).toBe(true)
  })

  it.each(['123', '12345', '12a4', 'password', '', ' 1234', '١٢٣٤'])('rejects %j', (pin) => {
    expect(pinSchema.safeParse(pin).success).toBe(false)
  })
})

describe('loginSchema', () => {
  it('normalizes the phone number and keeps the PIN', () => {
    expect(loginSchema.parse({ phone: '98765 43210', pin: '0000' })).toEqual({
      phone: '+919876543210',
      pin: '0000',
    })
  })

  it('reports field errors for empty input', () => {
    const result = loginSchema.safeParse({ phone: '', pin: '' })
    expect(result.success).toBe(false)
    const paths = result.error?.issues.map((issue) => issue.path[0])
    expect(paths).toEqual(expect.arrayContaining(['phone', 'pin']))
  })

  it('rejects a malformed phone', () => {
    const result = loginSchema.safeParse({ phone: '12345', pin: '1234' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('Enter a valid 10-digit mobile number')
  })
})
