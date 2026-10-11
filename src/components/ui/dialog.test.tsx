import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { Dialog, DialogContent, DialogHeader, Sheet, SheetContent, SheetHeader } from './dialog'

afterEach(cleanup)

function FormSheet() {
  const [open, setOpen] = useState(true)
  return (
    <>
      <p>{open ? 'open' : 'closed'}</p>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader title="Add food" />
          <label>
            Quantity
            <input defaultValue="" />
          </label>
        </SheetContent>
      </Sheet>
    </>
  )
}

function ConfirmDialog() {
  const [open, setOpen] = useState(true)
  return (
    <>
      <p>{open ? 'open' : 'closed'}</p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader title="Delete meal?" />
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * What Radix treats as an interaction outside the dialog. Its listener is
 * attached one tick after the dialog mounts, so wait for it first.
 */
async function pressOutside() {
  await new Promise((resolve) => setTimeout(resolve, 10))
  const outside =
    document.querySelector('[data-state="open"]:not([role="dialog"])') ?? document.body
  fireEvent.pointerDown(outside, { button: 0, pointerType: 'mouse' })
  fireEvent.mouseDown(outside)
  fireEvent.click(outside)
}

describe('Sheet (forms)', () => {
  it('is a labelled modal dialog with a named close button', () => {
    render(<FormSheet />)
    const dialog = screen.getByRole('dialog', { name: 'Add food' })
    expect(dialog).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })

  it('stays open when the backdrop is pressed, so typed input is not lost', async () => {
    render(<FormSheet />)
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '150' } })
    await pressOutside()
    expect(screen.getByText('open')).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>('Quantity').value).toBe('150')
  })

  it('closes on Escape and on the Close button (deliberate actions)', () => {
    render(<FormSheet />)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.getByText('closed')).toBeTruthy()
    cleanup()
    render(<FormSheet />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByText('closed')).toBeTruthy()
  })
})

describe('Dialog (confirmations)', () => {
  it('still closes when the backdrop is pressed', async () => {
    render(<ConfirmDialog />)
    await pressOutside()
    expect(screen.getByText('closed')).toBeTruthy()
  })
})
