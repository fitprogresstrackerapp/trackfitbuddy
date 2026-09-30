// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const PUBLIC = resolve(ROOT, 'public')

interface Icon {
  src: string
  sizes: string
  type: string
  purpose: string
}
const manifest = JSON.parse(readFileSync(resolve(PUBLIC, 'manifest.webmanifest'), 'utf8')) as {
  name: string
  short_name: string
  start_url: string
  scope: string
  display: string
  theme_color: string
  background_color: string
  icons: Icon[]
}
const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path: string): [number, number] {
  const bytes = readFileSync(path)
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG')
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}

describe('web app manifest', () => {
  it('describes an installable standalone app in the dark identity', () => {
    expect(manifest.name).toBe('TrackFitBuddy')
    expect(manifest.short_name.length).toBeLessThanOrEqual(15)
    expect(manifest).toMatchObject({ start_url: '/', scope: '/', display: 'standalone' })
    // Background token (spec §2): #0A0B0A.
    expect(manifest.theme_color.toLowerCase()).toBe('#0a0b0a')
    expect(manifest.background_color.toLowerCase()).toBe('#0a0b0a')
  })

  it('has valid 192/512 PNG icons and a maskable icon', () => {
    const png = manifest.icons.filter((icon) => icon.type === 'image/png')
    for (const icon of png) {
      const file = resolve(PUBLIC, icon.src.replace(/^\//, ''))
      expect(existsSync(file), icon.src).toBe(true)
      const [width, height] = pngSize(file)
      expect(`${String(width)}x${String(height)}`).toBe(icon.sizes)
    }
    const sizes = (purpose: string) =>
      png.filter((icon) => icon.purpose.split(' ').includes(purpose)).map((icon) => icon.sizes)
    expect(sizes('any')).toEqual(expect.arrayContaining(['192x192', '512x512']))
    expect(sizes('maskable')).toContain('512x512')
    for (const icon of manifest.icons) {
      expect(existsSync(resolve(PUBLIC, icon.src.replace(/^\//, ''))), icon.src).toBe(true)
    }
  })

  it('is linked from index.html with mobile metadata', () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />')
    expect(html).toMatch(/<meta name="theme-color" content="#0a0b0a" \/>/i)
    expect(html).toContain('viewport-fit=cover')
    const apple = /<link rel="apple-touch-icon" href="([^"]+)"/.exec(html)?.[1] ?? ''
    expect(pngSize(resolve(PUBLIC, apple.replace(/^\//, '')))).toEqual([180, 180])
    expect(html).toContain('<title>TrackFitBuddy</title>')
  })
})
