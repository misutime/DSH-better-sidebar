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

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })

    expect(mocks.gitLog).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('New commit')
    expect(container.querySelector('select')?.textContent).toContain('feature/next')
    expect(mocks.gitLog.mock.calls[1]).toEqual([
      { sessionId: 's1', cwd: '/repo' },
      20,
      0,
      expect.any(AbortSignal),
    ])
  })
})
