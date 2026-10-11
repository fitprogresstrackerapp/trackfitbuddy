import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { FormField } from './form-field'

afterEach(cleanup)

function field(props: { hint?: string; error?: string }) {
  render(
    <FormField id="weight" label="Weight" {...props}>
      {(control) => <input {...control} />}
    </FormField>,
  )
  return screen.getByLabelText('Weight')
}

/** Every id in aria-describedby must exist, and its text describes the field. */
function description(input: HTMLElement): string {
  const ids = (input.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)
  return ids
    .map((id) => {
      const element = document.getElementById(id)
      if (!element) throw new Error(`aria-describedby points at missing #${id}`)
      return element.textContent
    })
    .join(' ')
}

describe('FormField', () => {
  it('labels the control and describes it with the hint', () => {
    const input = field({ hint: 'In kilograms' })
    expect(input.getAttribute('aria-invalid')).toBe('false')
    expect(description(input)).toBe('In kilograms')
  })

  it('an error replaces the hint and is the only description', () => {
    const input = field({ hint: 'In kilograms', error: 'Enter a weight' })
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(description(input)).toBe('Enter a weight')
    expect(screen.queryByText('In kilograms')).toBeNull()
  })

  it('has no description when there is neither hint nor error', () => {
    expect(field({}).hasAttribute('aria-describedby')).toBe(false)
  })
})
