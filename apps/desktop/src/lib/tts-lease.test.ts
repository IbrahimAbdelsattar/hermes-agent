import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const setTtsLease = vi.fn(async (_lease: string, _active: boolean, _owner?: unknown) => ({ ok: true }))

vi.mock('@/hermes', () => ({
  getApiRequestConnection: () => null,
  getApiRequestProfile: () => null,
  setTtsLease: (lease: string, active: boolean, owner?: unknown) =>
    owner === undefined ? setTtsLease(lease, active) : setTtsLease(lease, active, owner)
}))

import { CONVERSATION_LEASE, READ_ALOUD_LEASE, resetTtsLeasesForTests, syncTtsLease } from './tts-lease'

describe('syncTtsLease', () => {
  beforeEach(() => {
    resetTtsLeasesForTests()
    setTtsLease.mockReset()
    setTtsLease.mockImplementation(async () => ({ ok: true }))
  })

  afterEach(() => {
    resetTtsLeasesForTests()
  })

  it('acquires on the first on and releases on off', async () => {
    await syncTtsLease(READ_ALOUD_LEASE, true)
    await syncTtsLease(READ_ALOUD_LEASE, false)

    expect(setTtsLease.mock.calls).toEqual([
      [READ_ALOUD_LEASE, true],
      [READ_ALOUD_LEASE, false]
    ])
  })

  it('skips an initial off — never releases a lease it did not hold', async () => {
    await syncTtsLease(CONVERSATION_LEASE, false)

    expect(setTtsLease).not.toHaveBeenCalled()
  })

  it('dedupes a repeat of the last sent state', async () => {
    await syncTtsLease(READ_ALOUD_LEASE, true)
    await syncTtsLease(READ_ALOUD_LEASE, true)
    await syncTtsLease(READ_ALOUD_LEASE, true)

    expect(setTtsLease).toHaveBeenCalledTimes(1)
  })

  it('queues an off behind an in-flight on so the wire never sees them reordered', async () => {
    let finishAcquire: () => void = () => undefined
    setTtsLease.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishAcquire = () => resolve({ ok: true })
        })
    )

    const on = syncTtsLease(CONVERSATION_LEASE, true)
    // Let the acquire actually go out (it runs on a microtask).
    await Promise.resolve()
    expect(setTtsLease.mock.calls).toEqual([[CONVERSATION_LEASE, true]])

    const off = syncTtsLease(CONVERSATION_LEASE, false)
    await Promise.resolve()
    // Still only the acquire — the release waits for it to finish.
    expect(setTtsLease).toHaveBeenCalledTimes(1)

    finishAcquire()
    await Promise.all([on, off])

    expect(setTtsLease.mock.calls).toEqual([
      [CONVERSATION_LEASE, true],
      [CONVERSATION_LEASE, false]
    ])
  })

  it('leaves the desired active state when on→off→on overtakes a deferred acquire', async () => {
    let failAcquire: (reason: Error) => void = () => undefined
    setTtsLease.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          failAcquire = reject
        })
    )

    const acquire = syncTtsLease(CONVERSATION_LEASE, true)
    await Promise.resolve()
    const release = syncTtsLease(CONVERSATION_LEASE, false)
    const acquireAgain = syncTtsLease(CONVERSATION_LEASE, true)

    failAcquire(new Error('acquire failed'))
    await Promise.all([acquire, release, acquireAgain])

    expect(setTtsLease.mock.calls).toEqual([
      [CONVERSATION_LEASE, true],
      [CONVERSATION_LEASE, true]
    ])
  })

  it('serializes a flip that reverses while the first request is in flight', async () => {
    const on = syncTtsLease(CONVERSATION_LEASE, true)
    const off = syncTtsLease(CONVERSATION_LEASE, false)
    await Promise.all([on, off])

    expect(setTtsLease.mock.calls).toEqual([
      [CONVERSATION_LEASE, true],
      [CONVERSATION_LEASE, false]
    ])
  })

  it('retries the desired active state after a failed request', async () => {
    setTtsLease.mockImplementationOnce(async () => {
      throw new Error('backend not ready')
    })

    await expect(syncTtsLease(READ_ALOUD_LEASE, true)).resolves.toBeUndefined()
    await syncTtsLease(READ_ALOUD_LEASE, true)

    expect(setTtsLease).toHaveBeenCalledTimes(2)
  })

  it('releases the old owner after a profile switch even when its acquire failed', async () => {
    const oldOwner = { connectionId: 'gw-a', profile: 'alpha' }
    let failAcquire: (reason: Error) => void = () => undefined
    setTtsLease.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          failAcquire = reject
        })
    )

    const acquiring = syncTtsLease(READ_ALOUD_LEASE, true, oldOwner)
    await Promise.resolve()
    failAcquire(new Error('acquire failed'))
    await acquiring
    await syncTtsLease(READ_ALOUD_LEASE, false, oldOwner)

    expect(setTtsLease.mock.calls).toEqual([
      [READ_ALOUD_LEASE, true, oldOwner],
      [READ_ALOUD_LEASE, false, oldOwner]
    ])
  })

  it('dedupes and releases leases per connection/profile owner', async () => {
    const alpha = { connectionId: 'gw-a', profile: 'default' }
    const beta = { connectionId: 'gw-b', profile: 'default' }

    await syncTtsLease(READ_ALOUD_LEASE, true, alpha)
    await syncTtsLease(READ_ALOUD_LEASE, true, alpha)
    await syncTtsLease(READ_ALOUD_LEASE, true, beta)

    expect(setTtsLease.mock.calls).toEqual([
      [READ_ALOUD_LEASE, true, alpha],
      [READ_ALOUD_LEASE, true, beta]
    ])

    await syncTtsLease(READ_ALOUD_LEASE, false, alpha)
    await syncTtsLease(READ_ALOUD_LEASE, true, alpha)

    expect(setTtsLease.mock.calls).toEqual([
      [READ_ALOUD_LEASE, true, alpha],
      [READ_ALOUD_LEASE, true, beta],
      [READ_ALOUD_LEASE, false, alpha],
      [READ_ALOUD_LEASE, true, alpha]
    ])
  })

  it('gives conversation and read-aloud leases distinct renderer identities', () => {
    expect(CONVERSATION_LEASE).toMatch(/^desktop:conversation:[a-z0-9]+$/)
    expect(READ_ALOUD_LEASE).toMatch(/^desktop:read-aloud:[a-z0-9]+$/)
    expect(READ_ALOUD_LEASE).not.toBe(CONVERSATION_LEASE)
  })
})
