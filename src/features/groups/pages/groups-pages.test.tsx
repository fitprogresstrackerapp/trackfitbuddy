import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderApp, signedIn } from '@/test/auth-harness'

import {
  createGroup,
  fetchGroupDay,
  fetchGroupMembers,
  fetchGroupWeek,
  fetchMyGroups,
  joinGroup,
  leaveGroup,
  previewGroup,
  removeMember,
  setMemberRole,
  type GroupMember,
  type GroupSummary,
  type MemberDay,
  type MemberWeekDay,
} from '../api/groups-data'
import type * as GroupsData from '../api/groups-data'

vi.mock('../api/groups-data', async (importOriginal) => {
  const actual = await importOriginal<typeof GroupsData>()
  return {
    ...actual,
    fetchMyGroups: vi.fn(),
    fetchGroupMembers: vi.fn(),
    fetchGroupDay: vi.fn(),
    fetchGroupWeek: vi.fn(),
    createGroup: vi.fn(),
    previewGroup: vi.fn(),
    joinGroup: vi.fn(),
    leaveGroup: vi.fn(),
    removeMember: vi.fn(),
    setMemberRole: vi.fn(),
  }
})

const ME = '00000000-0000-0000-0000-0000000000a1'
const TODAY = '2026-09-30'
const NOW = new Date('2026-09-30T06:00:00Z')

const GROUP: GroupSummary = {
  id: 'g1',
  name: 'Morning crew',
  description: 'Walks and lifts',
  code: 'ABCDEFGH',
  myRole: 'ADMIN',
  memberCount: 2,
  joinedAt: '2026-09-01T04:00:00Z',
  historyFrom: '2026-09-01',
}

const MEMBERS: GroupMember[] = [
  { userId: ME, name: 'Asha', role: 'ADMIN', joinedAt: '2026-09-01T04:00:00Z' },
  { userId: 'b2', name: 'Ben', role: 'MEMBER', joinedAt: '2026-09-02T04:00:00Z' },
]

const DAY: MemberDay[] = [
  {
    userId: ME,
    name: 'Asha',
    role: 'ADMIN',
    calories: null,
    caloriesTarget: null,
    proteinG: null,
    proteinTargetG: null,
    steps: null,
    stepsTarget: null,
    workoutLogged: false,
  },
  {
    userId: 'b2',
    name: 'Ben',
    role: 'MEMBER',
    calories: 1650.4,
    caloriesTarget: 2000,
    proteinG: 117.6,
    proteinTargetG: 140,
    steps: 7842,
    stepsTarget: null,
    workoutLogged: true,
  },
]

// TODAY is Wednesday 30 Sep: this week is 28 Sep – 4 Oct, last week 21–27 Sep.
const TOLERANCE = { nutrient: 0.85, calorieLower: 0.85, calorieUpper: 1.1 }
function weekDay(
  date: string,
  userId: string,
  name: string,
  overrides: Partial<MemberWeekDay> = {},
): MemberWeekDay {
  return {
    date,
    userId,
    name,
    role: userId === ME ? 'ADMIN' : 'MEMBER',
    calories: null,
    caloriesTarget: 2000,
    proteinG: null,
    proteinTargetG: 140,
    steps: null,
    workoutLogged: false,
    tolerance: TOLERANCE,
    workoutsPerWeek: 4,
    cycleStart: '2026-09-01',
    ...overrides,
  }
}
const datesFrom = (start: string, end: string) => {
  const dates: string[] = []
  for (
    let d = new Date(`${start}T00:00:00Z`);
    d <= new Date(`${end}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    dates.push(d.toISOString().slice(0, 10))
  }
  return dates
}

// Zara logs the most, Ben the least: the order must still be You, Ben, Zara.
const THIS_WEEK: MemberWeekDay[] = datesFrom('2026-09-28', '2026-09-30').flatMap((date) => [
  weekDay(date, ME, 'Asha', {
    calories: date < TODAY ? 1950 : null,
    proteinG: date < TODAY ? 150 : null,
    workoutLogged: date === '2026-09-28',
    steps: 8000,
  }),
  weekDay(date, 'z3', 'Zara', {
    calories: 2000,
    proteinG: 160,
    workoutLogged: true,
    steps: 15000,
  }),
  // Ben joined on Wednesday: he counts from today only.
  ...(date === TODAY ? [weekDay(date, 'b2', 'Ben')] : []),
])
const LAST_WEEK: MemberWeekDay[] = datesFrom('2026-09-21', '2026-09-27').flatMap((date) => [
  weekDay(date, ME, 'Asha', {
    calories: date === '2026-09-21' ? 2600 : null,
    proteinG: date === '2026-09-21' ? 150 : null,
    steps: date === '2026-09-21' ? 6000 : null,
  }),
  weekDay(date, 'z3', 'Zara', { calories: 2000, proteinG: 160 }),
])

class ResizeObserverStub {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

const section = (name: string) => {
  const element = screen.getByRole('heading', { level: 2, name }).closest('section')
  if (!element) throw new Error(`section ${name} missing`)
  return element
}

async function openGroup(path = '/groups/g1') {
  renderApp({ path, state: signedIn() })
  await screen.findByRole('heading', { level: 1, name: 'Morning crew' })
  await screen.findByRole('article', { name: 'Ben' })
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(fetchMyGroups).mockResolvedValue([GROUP])
  vi.mocked(fetchGroupMembers).mockResolvedValue(MEMBERS)
  vi.mocked(fetchGroupDay).mockResolvedValue(DAY)
  vi.mocked(fetchGroupWeek).mockImplementation((_client, _group, weekStart) =>
    Promise.resolve(weekStart === '2026-09-28' ? THIS_WEEK : LAST_WEEK),
  )
  for (const fn of [leaveGroup, removeMember, setMemberRole]) vi.mocked(fn).mockResolvedValue()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Groups page', () => {
  it('with no groups, offers creating or joining one', async () => {
    vi.mocked(fetchMyGroups).mockResolvedValue([])
    renderApp({ path: '/groups', state: signedIn() })
    expect(await screen.findByText('You’re not in a group yet.')).toBeTruthy()
    const groups = section('Your groups')
    expect(within(groups).getByRole('button', { name: 'Create group' })).toBeTruthy()
    expect(within(groups).getByRole('button', { name: 'Join group' })).toBeTruthy()
  })

  it('lists groups compactly: name, description, member count and my role', async () => {
    renderApp({ path: '/groups', state: signedIn() })
    const card = await screen.findByRole('link', { name: /Morning crew/ })
    expect(card.getAttribute('href')).toBe('/groups/g1')
    expect(card.textContent).toContain('Walks and lifts')
    expect(card.textContent).toContain('2 members')
    expect(card.textContent).toContain('Group admin')
    expect(document.body.textContent).not.toMatch(/rank|leaderboard|score|points/i)
  })

  it('creates a group and shows its server-generated code', async () => {
    vi.mocked(fetchMyGroups).mockResolvedValue([])
    vi.mocked(createGroup).mockResolvedValue({ id: 'g9', code: 'QRSTUVWX' })
    renderApp({ path: '/groups', state: signedIn() })
    fireEvent.click(await screen.findByRole('button', { name: 'Create group' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create group' }))
    expect(await within(dialog).findByText('Enter a group name')).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('Group name'), {
      target: { value: '  Evening walkers ' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create group' }))
    expect(await within(dialog).findByText('QRST-UVWX')).toBeTruthy()
    expect(createGroup).toHaveBeenCalledWith(expect.anything(), {
      name: 'Evening walkers',
      description: null,
    })
    expect(within(dialog).getByRole('button', { name: 'Copy code' })).toBeTruthy()
    expect(
      within(dialog)
        .getByRole('link', { name: /Open group/ })
        .getAttribute('href'),
    ).toBe('/groups/g9')
  })

  it('join: enter code → confirm group → join, then open the group', async () => {
    vi.mocked(previewGroup).mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'g1',
      name: 'Morning crew',
      description: 'Walks and lifts',
      memberCount: 2,
      alreadyMember: false,
    })
    vi.mocked(joinGroup).mockResolvedValue('g1')
    renderApp({ path: '/groups', state: signedIn() })
    fireEvent.click(await screen.findByRole('button', { name: 'Join group' }))
    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByLabelText('Group code')
    fireEvent.change(input, { target: { value: 'zzzz-zzzz' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
    expect(await within(dialog).findByText(/doesn’t match a group/)).toBeTruthy()
    fireEvent.change(input, { target: { value: 'abcd-efgh' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
    expect(await within(dialog).findByText('Morning crew')).toBeTruthy()
    expect(vi.mocked(previewGroup).mock.calls[1]?.[1]).toBe('ABCDEFGH')
    expect(dialog.textContent).toMatch(/Weight, body measurements and meals stay private/)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Join group' }))
    await waitFor(() => {
      expect(joinGroup).toHaveBeenCalledWith(expect.anything(), 'ABCDEFGH')
    })
    expect(await screen.findByRole('heading', { level: 1, name: 'Morning crew' })).toBeTruthy()
  })

  it('shows an error with a retry', async () => {
    vi.mocked(fetchMyGroups).mockRejectedValue(new Error('offline'))
    renderApp({ path: '/groups', state: signedIn() })
    expect(await screen.findByText('Groups unavailable')).toBeTruthy()
    vi.mocked(fetchMyGroups).mockResolvedValue([GROUP])
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('link', { name: /Morning crew/ })).toBeTruthy()
  })
})

describe('Group detail page', () => {
  it('shows each member’s permitted metrics for today; missing stays —', async () => {
    await openGroup()
    expect(fetchGroupDay).toHaveBeenCalledWith(expect.anything(), 'g1', TODAY)
    const ben = screen.getByRole('article', { name: 'Ben' })
    expect(ben.textContent).toContain('1,650 / 2,000 kcal')
    expect(ben.textContent).toContain('118 / 140 g')
    expect(ben.textContent).toContain('7,842 steps')
    expect(ben.textContent).not.toContain('/ 0')
    expect(ben.textContent).toContain('Workout done')
    const me = screen.getByRole('article', { name: 'Asha' })
    expect(within(me).getAllByText('Not recorded')).toHaveLength(3)
    expect(me.textContent).toContain('No workout logged')
    expect(me.textContent).not.toMatch(/\b0 kcal/)
    // The cards carry only the shared metrics (the page’s own privacy note names what is private).
    const cards = screen
      .getAllByRole('article')
      .map((card) => card.textContent)
      .join(' ')
    expect(cards).not.toMatch(/weight|body fat|inbody|kg|height|rank|leaderboard|score/i)
    expect(document.body.textContent).not.toMatch(/rank|leaderboard|score|points/i)
  })

  it('shows the join code to share', async () => {
    await openGroup()
    expect(screen.getByText('ABCD-EFGH')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeTruthy()
  })

  it('changing the date loads that date; nothing before the viewable history', async () => {
    await openGroup('/groups/g1?date=2026-09-02')
    expect(fetchGroupDay).toHaveBeenLastCalledWith(expect.anything(), 'g1', '2026-09-02')
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }))
    await waitFor(() => {
      expect(fetchGroupDay).toHaveBeenLastCalledWith(expect.anything(), 'g1', '2026-09-01')
    })
    expect(screen.getByRole('button', { name: 'Previous day' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Today' }))
    await waitFor(() => {
      expect(fetchGroupDay).toHaveBeenLastCalledWith(expect.anything(), 'g1', TODAY)
    })
  })

  it('a date with no shared data says so instead of showing zeros', async () => {
    vi.mocked(fetchGroupDay).mockResolvedValue([])
    renderApp({ path: '/groups/g1', state: signedIn() })
    expect(await screen.findByText(/No shared data for this date/)).toBeTruthy()
  })

  it('the group admin can remove a member after confirming', async () => {
    await openGroup()
    const members = section('Members')
    fireEvent.click(within(members).getByRole('button', { name: 'Remove Ben' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('lose access to the group immediately')
    expect(removeMember).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => {
      expect(removeMember).toHaveBeenCalledWith(expect.anything(), 'g1', 'b2')
    })
  })

  it('a normal member sees no admin controls', async () => {
    vi.mocked(fetchMyGroups).mockResolvedValue([{ ...GROUP, myRole: 'MEMBER' }])
    await openGroup()
    const members = section('Members')
    expect(within(members).queryByRole('button', { name: /Remove/ })).toBeNull()
    expect(within(members).queryByRole('combobox')).toBeNull()
  })

  it('the only admin is asked to appoint another admin before leaving', async () => {
    await openGroup()
    await screen.findByText('Ben', { selector: 'p' })
    fireEvent.click(screen.getByRole('button', { name: 'Leave group' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('You are the only group admin')
    expect(within(dialog).queryByRole('button', { name: 'Leave group' })).toBeNull()
  })

  it('a member leaves after confirming and returns to Groups', async () => {
    vi.mocked(fetchMyGroups).mockResolvedValue([{ ...GROUP, myRole: 'MEMBER' }])
    await openGroup()
    await screen.findByText('Ben', { selector: 'p' })
    fireEvent.click(screen.getByRole('button', { name: 'Leave group' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('lose access to the group’s shared progress immediately')
    vi.mocked(fetchMyGroups).mockResolvedValue([])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Leave group' }))
    await waitFor(() => {
      expect(leaveGroup).toHaveBeenCalledWith(expect.anything(), 'g1')
    })
    expect(await screen.findByText('You’re not in a group yet.')).toBeTruthy()
  })

  it('a group the user is no longer in is not shown', async () => {
    vi.mocked(fetchMyGroups).mockResolvedValue([])
    renderApp({ path: '/groups/g1', state: signedIn() })
    expect(await screen.findByText('This group isn’t available')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Group' })).toBeTruthy()
    expect(fetchGroupDay).not.toHaveBeenCalled()
  })
})

describe('Group weekly view (shared accountability; spec §47: no ranking, leaderboard or score)', () => {
  const THREE: GroupSummary = { ...GROUP, memberCount: 3 }

  async function openWeek(path = '/groups/g1?view=week') {
    vi.mocked(fetchMyGroups).mockResolvedValue([THREE])
    renderApp({ path, state: signedIn() })
    await screen.findByRole('heading', { level: 1, name: 'Morning crew' })
    await screen.findByRole('heading', { level: 2, name: 'This week' })
    await waitFor(() => {
      expect(document.querySelector('[data-slot="skeleton"]')).toBeNull()
    })
  }

  it('keeps Today as the default view', async () => {
    await openGroup()
    expect(screen.getByRole('tab', { name: 'Day', selected: true })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Today' })).toBeTruthy()
  })

  it('shows your week with changes since last week, only where both weeks have data', async () => {
    await openWeek()
    const yours = section('Your week')
    expect(yours.textContent).toContain('Sep 28 – Oct 4')
    // Calories in range: 2 of 2 completed days (last week 0 of 1) → 100%, up 100 pts.
    expect(yours.textContent).toContain('100%')
    expect(yours.textContent).toContain('100 pts')
    expect(yours.textContent).toContain('1 / 4')
    expect(yours.textContent).toContain('8k/day')
    expect(yours.textContent).toContain('2k/day')
    // Protein met both weeks at 100%: no change, not an invented difference.
    expect(yours.textContent).toContain('No change')
  })

  it('lists every member you first and then by name, never by results', async () => {
    await openWeek()
    const names = screen
      .getAllByRole('rowheader')
      .map((cell) => cell.textContent.replace(/From.*/, '').trim())
    expect(names).toEqual(['You', 'Ben', 'Zara'])
    const cards = screen.getAllByRole('article').map((card) => card.getAttribute('aria-label'))
    expect(cards).toEqual(['You', 'Ben', 'Zara'])
  })

  it('counts members from the day they joined, and shows missing values as —', async () => {
    await openWeek()
    const ben = screen.getByRole('article', { name: 'Ben' })
    expect(ben.textContent).toContain('From WED 30 SEP')
    expect(ben.textContent).toContain('—')
    expect(ben.textContent).not.toMatch(/0%/)
  })

  it('summarises group participation as counts, not as who did better', async () => {
    await openWeek()
    const activity = screen.getByRole('region', { name: 'Group activity' })
    expect(activity.textContent).toContain('2 / 3members active')
    expect(activity.textContent).toContain('2 / 3members logged a workout')
  })

  it('switches to last week with the same rules', async () => {
    await openWeek()
    fireEvent.click(screen.getByRole('radio', { name: 'Last week' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Last week' })).toBeTruthy()
    await waitFor(() => {
      expect(fetchGroupWeek).toHaveBeenCalledWith(expect.anything(), 'g1', '2026-09-21')
    })
    expect(screen.getByText('Sep 21 – 27')).toBeTruthy()
  })

  it('a group of one invites friends instead of comparing', async () => {
    vi.mocked(fetchMyGroups).mockResolvedValue([{ ...GROUP, memberCount: 1 }])
    vi.mocked(fetchGroupWeek).mockResolvedValue(THIS_WEEK.filter((day) => day.userId === ME))
    renderApp({ path: '/groups/g1?view=week', state: signedIn() })
    expect(await screen.findByText('You’re the first one here.')).toBeTruthy()
    expect(screen.getByText('Invite friends to start tracking together.')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Invite members' }).textContent).toContain(
      'ABCD-EFGH',
    )
    expect(screen.queryByRole('region', { name: 'Group activity' })).toBeNull()
  })

  it('offers the code to invite members', async () => {
    await openWeek()
    const invite = screen.getByRole('region', { name: 'Invite members' })
    expect(invite.textContent).toContain('ABCD-EFGH')
    expect(invite.textContent).toContain('Share this code with your friends')
    expect(within(invite).getByRole('button', { name: /copy/i })).toBeTruthy()
  })

  it('shows no ranking, leaderboard, score, position or winner anywhere', async () => {
    await openWeek()
    const text = document.body.textContent
    expect(text).not.toMatch(
      /\b(rank|ranked|ranking|leaderboard|score|points|place|winner|winning|top performer|best performer|ahead of|behind|beat)\b/i,
    )
    expect(text).not.toMatch(/#\d/)
    fireEvent.click(screen.getByRole('radio', { name: 'Last week' }))
    await screen.findByRole('heading', { level: 2, name: 'Last week' })
    expect(document.body.textContent).not.toMatch(/\b(rank|leaderboard|score)\b/i)
  })
})
