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
// (several composers/tiles observe the same toggle), serializes per lease so a
// fast on→off→on can't be reordered on the wire, and never surfaces failures —
// warm-up is an optimization; the toggle itself must not depend on it.

// Per-renderer id so two windows in conversation mode hold DISTINCT leases —
// window A ending its conversation must not release the engine window B is
// still speaking through. Read-aloud mirrors one config key shared by every
// window, so it deliberately uses one shared lease name.
const RENDERER_ID = Math.random().toString(36).slice(2, 10)

export const READ_ALOUD_LEASE = 'desktop:read-aloud'
export const CONVERSATION_LEASE = `desktop:conversation:${RENDERER_ID}`

function leaseStateKey(lease: string, owner?: OwnerScope): string {
  const connectionId = owner?.connectionId || getApiRequestConnection() || 'primary'
  const profile = owner?.profile || getApiRequestProfile() || 'default'

  return `${connectionId}::${profile}::${lease}`
}

const sent = new Map<string, boolean>()
const inFlight = new Map<string, Promise<void>>()

/**
 * Bring the backend's view of `lease` in line with `active`. Idempotent: a
 * repeat of the last sent state is a no-op. The initial `false` (nothing was
 * ever acquired) is also skipped — releasing a lease we never held would only
 * churn the backend on app start.
 */
export function syncTtsLease(lease: string, active: boolean, owner?: OwnerScope): Promise<void> {
  const key = leaseStateKey(lease, owner)
  const last = sent.get(key)

  if (last === active || (last === undefined && !active)) {
    return inFlight.get(key) ?? Promise.resolve()
  }

  sent.set(key, active)

  const previous = inFlight.get(key) ?? Promise.resolve()

  const next = previous
    .then(async () => {
      // Latest intent wins: if the toggle flipped again while we were queued,
      // the newer call sends its own state and this one has nothing to say.
      if (sent.get(key) !== active) {
        return
      }

      await setTtsLease(lease, active, owner)
    })
    .catch(() => {
      // Backend not up yet / older backend without the endpoint / warm-up
      // failure: forget what we "sent" so the next flip retries honestly.
      if (sent.get(key) === active) {
        sent.delete(key)
      }
    })
    .finally(() => {
      if (inFlight.get(key) === next) {
        inFlight.delete(key)
      }
    })

  inFlight.set(key, next)

  return next
}

/** Test seam — forget every sent state. */
export function resetTtsLeasesForTests() {
  sent.clear()
  inFlight.clear()
}
