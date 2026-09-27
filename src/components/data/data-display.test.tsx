import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { DataRow, Metric } from './metric'
import { ProgressBar } from './progress-bar'
import { StatusBadge } from './status-badge'
import { TrendIndicator } from './trend-indicator'

afterEach(cleanup)

describe('ProgressBar', () => {
  it('exposes value, range and text to assistive tech', () => {
    render(<ProgressBar label="Protein" value={105} max={140} valueText="105 of 140 g" />)
    const bar = screen.getByRole('progressbar', { name: 'Protein' })
    expect(bar.getAttribute('aria-valuenow')).toBe('105')
    expect(bar.getAttribute('aria-valuemax')).toBe('140')
    expect(bar.getAttribute('aria-valuetext')).toBe('105 of 140 g')
    expect(bar.getAttribute('data-state')).toBe('default')
  })

  it('marks a met target as complete and caps overflow', () => {
    render(<ProgressBar label="Calories" value={2400} max={2000} />)
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('data-state')).toBe('complete')
    expect(bar.getAttribute('aria-valuenow')).toBe('2000')
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('100%')
  })

  it('shows missing data as missing, not zero', () => {
    render(<ProgressBar label="Fiber" value={null} max={30} />)
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('data-state')).toBe('missing')
    expect(bar.getAttribute('aria-valuenow')).toBeNull()
    expect(bar.getAttribute('aria-valuetext')).toBe('No data')
    expect(bar.firstElementChild).toBeNull()
  })

  it('respects an explicit attention tone', () => {
    render(<ProgressBar label="Calories" value={2400} max={2000} tone="attention" />)
    expect(screen.getByRole('progressbar').getAttribute('data-state')).toBe('attention')
  })
})

describe('Metric and DataRow', () => {
  it('formats numbers with grouping', () => {
    render(<Metric value={7842} unit="STEPS" />)
    expect(screen.getByText('7,842')).toBeTruthy()
  })

  it('renders missing values as "No data" instead of 0', () => {
    render(<DataRow label="Fiber" value={null} target={30} unit="G" />)
    expect(screen.queryByText('0')).toBeNull()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('No data')
  })
})

describe('StatusBadge', () => {
  it('always carries text, not colour alone', () => {
    render(<StatusBadge status="locked" />)
    expect(screen.getByText('Locked')).toBeTruthy()
  })
})

describe('TrendIndicator', () => {
  it('describes direction in words for screen readers', () => {
    render(<TrendIndicator delta={-0.8} unit="KG" favorable="down" />)
    expect(screen.getByText('Down 0.8 KG')).toBeTruthy()
  })
})
