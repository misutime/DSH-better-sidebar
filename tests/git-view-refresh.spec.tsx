// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'

const mocks = vi.hoisted(() => ({
  gitStatus: vi.fn(),
  gitBranch: vi.fn(),
  gitLog: vi.fn(),
}))

vi.mock('../src/client/api.ts', () => ({ api: mocks }))

import { GitView } from '../src/client/GitView.tsx'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function entry(hash: string, subject: string) {
  return {
    hash,
    hashFull: `${hash}-full`,
    subject,
    author: 'Alice',
    date: '2024-01-01 10:00:00 +0000',
    refs: '',
  }
}

describe('GitView automatic refresh', () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  afterEach(() => {
    if (root !== undefined) act(() => { root!.unmount() })
    container?.remove()
    root = undefined
    container = undefined
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('refreshes history and branches on the visible-tab interval', async () => {
    vi.useFakeTimers()
    mocks.gitStatus
      .mockResolvedValueOnce({ isRepo: true, branch: 'main', entries: [] })
      .mockResolvedValue({ isRepo: true, branch: 'feature/next', entries: [] })
    mocks.gitBranch
      .mockResolvedValueOnce({ current: 'main', names: ['main'] })
      .mockResolvedValue({ current: 'feature/next', names: ['main', 'feature/next'] })
    mocks.gitLog
      .mockResolvedValueOnce([entry('old1234', 'Old commit')])
      .mockResolvedValue([entry('new5678', 'New commit'), entry('old1234', 'Old commit')])

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(createElement(GitView, {
        scope: { sessionId: 's1', cwd: '/repo' },
        visible: true,
        onOpenFile: () => {},
        onOpenDiff: () => {},
      }))
    })

    expect(container.textContent).toContain('Old commit')
    expect(container.textContent).not.toContain('New commit')
    expect(container.querySelector('[class*="gitLastRefresh"]')).not.toBeNull()

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })

    expect(mocks.gitLog).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('New commit')
    expect(container.querySelector('select')?.textContent).toContain('feature/next')
    expect(mocks.gitLog.mock.calls[1]).toEqual([
      { sessionId: 's1', cwd: '/repo' },
      21,
      0,
      expect.any(AbortSignal),
    ])
  })

  it('resets the loaded history window when switching sessions', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => entry(`a${index}`, `A commit ${index}`))
    const secondPage = Array.from({ length: 20 }, (_, index) => entry(`a-more-${index}`, `A more ${index}`))
    mocks.gitStatus.mockResolvedValue({ isRepo: true, branch: 'main', entries: [] })
    mocks.gitBranch.mockResolvedValue({ current: 'main', names: ['main'] })
    mocks.gitLog
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage)
      .mockResolvedValueOnce([entry('b1', 'B commit')])

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(createElement(GitView, {
        scope: { sessionId: 'session-a', cwd: '/repo-a' },
        visible: true,
        onOpenFile: () => {},
        onOpenDiff: () => {},
      }))
    })

    const loadMore = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Load more'))
    expect(loadMore).toBeDefined()
    await act(async () => { (loadMore as HTMLButtonElement).click() })
    expect(mocks.gitLog.mock.calls[1]).toEqual([{ sessionId: 'session-a', cwd: '/repo-a' }, 20, 20])

    await act(async () => {
      root!.render(createElement(GitView, {
        scope: { sessionId: 'session-b', cwd: '/repo-b' },
        visible: true,
        onOpenFile: () => {},
        onOpenDiff: () => {},
      }))
    })

    expect(mocks.gitLog.mock.calls[2]).toEqual([{ sessionId: 'session-b', cwd: '/repo-b' }, 20, 0])
    expect(container.textContent).toContain('B commit')
    expect(container.textContent).not.toContain('A commit 0')
  })

  it('keeps the end-of-history state after an empty page and a later poll', async () => {
    vi.useFakeTimers()
    const page = Array.from({ length: 20 }, (_, index) => entry(`a${index}`, `A commit ${index}`))
    mocks.gitStatus.mockResolvedValue({ isRepo: true, branch: 'main', entries: [] })
    mocks.gitBranch.mockResolvedValue({ current: 'main', names: ['main'] })
    mocks.gitLog
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce([])
      .mockResolvedValue(page)

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(createElement(GitView, {
        scope: { sessionId: 's1', cwd: '/repo' },
        visible: true,
        onOpenFile: () => {},
        onOpenDiff: () => {},
      }))
    })
    const loadMore = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Load more'))
    await act(async () => { (loadMore as HTMLButtonElement).click() })
    expect(container.textContent).not.toContain('Load more')

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })

    expect(mocks.gitLog.mock.calls[2]?.[1]).toBe(21)
    expect(container.textContent).not.toContain('Load more')
  })

  it('does not advance the refresh timestamp when a data category fails', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    mocks.gitStatus.mockResolvedValue({ isRepo: true, branch: 'main', entries: [] })
    mocks.gitBranch
      .mockResolvedValueOnce({ current: 'main', names: ['main'] })
      .mockRejectedValue(new Error('branch unavailable'))
    mocks.gitLog.mockResolvedValue([entry('a1', 'A commit')])

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(createElement(GitView, {
        scope: { sessionId: 's1', cwd: '/repo' },
        visible: true,
        onOpenFile: () => {},
        onOpenDiff: () => {},
      }))
    })
    expect(container.querySelector('[class*="gitLastRefresh"]')?.textContent).toContain('0 seconds ago')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })

    expect(container.querySelector('[class*="gitLastRefresh"]')?.textContent).toContain('5 seconds ago')
  })
})
