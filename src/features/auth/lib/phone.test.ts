import { describe, expect, it } from 'vitest'

import { formatIndianPhone, normalizeIndianPhone } from './phone'

describe('normalizeIndianPhone', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['+91 98765-43210', '+919876543210'],
    [' (+91) 98765.43210 ', '+919876543210'],
    ['6000000000', '+916000000000'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeIndianPhone(input)).toBe(expected)
  })

  it.each([
    [''],
    ['98765'],
    ['98765432101'],
    ['5876543210'], // Indian mobiles start with 6–9
    ['+1 415 555 0100'], // non-Indian country code
    ['98765a3210'],
    ['+9198765432'],
  ])('rejects %s', (input) => {
    expect(normalizeIndianPhone(input)).toBeNull()
  })
})

describe('formatIndianPhone', () => {
  it('formats the subscriber number for display', () => {
    expect(formatIndianPhone('+919876543210')).toBe('98765 43210')
  })
})
