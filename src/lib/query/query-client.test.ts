import { MutationObserver, onlineManager } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from './query-client'

afterEach(() => {
  onlineManager.setOnline(true)
})

describe('query client', () => {
  it('attempts a save even when the browser reports it is offline', async () => {
    onlineManager.setOnline(false)
    const save = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    const observer = new MutationObserver(createQueryClient(), { mutationFn: save })

    // Not paused: the request is made and its failure reaches the form.
    await expect(observer.mutate()).rejects.toThrow('Failed to fetch')
    expect(save).toHaveBeenCalledTimes(1)
    expect(observer.getCurrentResult()).toMatchObject({ isPaused: false, status: 'error' })
  })

  it('does not retry a failed save on its own (no duplicate records)', async () => {
    const save = vi.fn(() => Promise.reject(new Error('server said no')))
    const observer = new MutationObserver(createQueryClient(), { mutationFn: save })
    await expect(observer.mutate()).rejects.toThrow('server said no')
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('the library default would have paused the save instead', async () => {
    // Documents why networkMode is set: with the default, nothing is attempted.
    const { QueryClient } = await import('@tanstack/react-query')
    onlineManager.setOnline(false)
    const save = vi.fn(() => Promise.resolve())
    const observer = new MutationObserver(new QueryClient(), { mutationFn: save })
    void observer.mutate()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(save).not.toHaveBeenCalled()
    expect(observer.getCurrentResult().isPaused).toBe(true)
  })
})
