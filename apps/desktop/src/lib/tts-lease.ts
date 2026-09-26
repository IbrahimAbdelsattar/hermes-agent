import type { OwnerScope } from '@/api/client'
import { getApiRequestConnection, getApiRequestProfile, setTtsLease } from '@/hermes'

// The desktop's speech-output toggles — "Read replies aloud" and voice
// conversation mode — are the user telling us TTS is about to be needed (or no
// longer is). The backend turns that into engine lifecycle: acquiring a lease
// pre-loads the configured provider (a local piper/kittentts model, a lazily
// installed SDK) so the first spoken reply starts hot instead of paying the load
// as dead air; releasing the last lease unloads resident local models.
//
// This module is the renderer's single choke point for that signal. It dedupes
// (several composers/tiles observe the same toggle), reconciles one mutable
// desired state per owner, and never surfaces failures — warm-up is an
// optimization; the toggle itself must not depend on it.

// Per-renderer id so two windows hold DISTINCT leases — window A ending its
// conversation or read-aloud must not release the engine window B still uses.
const RENDERER_ID = Math.random().toString(36).slice(2, 10)

export const READ_ALOUD_LEASE = `desktop:read-aloud:${RENDERER_ID}`
export const CONVERSATION_LEASE = `desktop:conversation:${RENDERER_ID}`

function leaseStateKey(lease: string, owner?: OwnerScope): string {
  const connectionId = owner?.connectionId || getApiRequestConnection() || 'primary'
  const profile = owner?.profile || getApiRequestProfile() || 'default'

  return `${connectionId}::${profile}::${lease}`
}

interface LeaseState {
  backendActive: boolean
  backendKnown: boolean
  desiredActive: boolean
  lease: string
  observedRevision: number
  owner?: OwnerScope
  revision: number
  running: boolean
  waiters: Array<() => void>
}

const states = new Map<string, LeaseState>()

async function reconcileLeaseState(state: LeaseState): Promise<void> {
  if (state.running) {
    return
  }

  state.running = true

  try {
    while (state.observedRevision !== state.revision) {
      const revision = state.revision
      const active = state.desiredActive

      state.observedRevision = revision

      if (state.backendKnown && active === state.backendActive) {
        continue
      }

      try {
        await setTtsLease(state.lease, active, state.owner)
        state.backendActive = active
        state.backendKnown = true
      } catch {
        state.backendKnown = false

        if (state.revision === revision) {
          break
        }
      }
    }
  } finally {
    state.running = false

    for (const resolve of state.waiters) {
      resolve()
    }

    state.waiters = []
  }
}

/**
 * Bring the backend's view of `lease` in line with the latest desired state.
 * The initial `false` is a no-op; repeated desired states are deduped.
 */
export function syncTtsLease(lease: string, active: boolean, owner?: OwnerScope): Promise<void> {
  const key = leaseStateKey(lease, owner)
  let state = states.get(key)

  if (!state) {
    state = {
      backendActive: false,
      backendKnown: true,
      desiredActive: false,
      lease,
      observedRevision: 0,
      revision: 0,
      running: false,
      waiters: []
    }
    states.set(key, state)
  }

  const current = state
  current.owner = owner
  current.desiredActive = active
  current.revision += 1

  const completion = new Promise<void>(resolve => current.waiters.push(resolve))

  void reconcileLeaseState(current)

  return completion
}

/** Test seam — forget every owner state. */
export function resetTtsLeasesForTests() {
  states.clear()
}
