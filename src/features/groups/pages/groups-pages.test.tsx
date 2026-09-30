import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderApp, signedIn } from '@/test/auth-harness'

import {
  createGroup,
  fetchGroupDay,
  fetchGroupMembers,
  fetchMyGroups,
  joinGroup,
  leaveGroup,
  previewGroup,
  removeMember,
  setMemberRole,
  type GroupMember,
  type GroupSummary,
  type MemberDay,
} from '../api/groups-data'
import type * as GroupsData from '../api/groups-data'

vi.mock('../api/groups-data', async (importOriginal) => {
  const actual = await importOriginal<typeof GroupsData>()
  return {
    ...actual,
    fetchMyGroups: vi.fn(),
    fetchGroupMembers: vi.fn(),
    fetchGroupDay: vi.fn(),
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
    expect(await screen.findByText('You are not in any groups yet.')).toBeTruthy()
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
    expect(await screen.findByText('You are not in any groups yet.')).toBeTruthy()
  })

  it('a group the user is no longer in is not shown', async () => {
    vi.mocked(fetchMyGroups).mockResolvedValue([])
    renderApp({ path: '/groups/g1', state: signedIn() })
    expect(await screen.findByText('This group isn’t available')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Group' })).toBeTruthy()
    expect(fetchGroupDay).not.toHaveBeenCalled()
  })
})
