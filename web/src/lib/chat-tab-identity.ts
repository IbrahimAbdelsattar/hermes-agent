/**
 * Chat tab identity: pair the `/api/events` channel lifetime with the PTY
 * attach-token lifetime.
 *
 * Root cause (#voice silent reply after reload): ChatPage minted a random
 * channel per mount while `ptyAttachToken()` survived reloads in
 * sessionStorage. `/api/pty` then reattached to the living PTY child whose
 * `HERMES_TUI_SIDECAR_URL` still published `message.start/delta/complete` to
 * the OLD channel, while the sidebar and voice controls subscribed to the NEW
 * one — the reply arrived in the terminal but never spoke.
 *
 * The channel is derived deterministically from the claimed attach token
 * (plus the resume/profile scope that already keys the server PTY), so:
 * reload reuses the pair, a duplicate tab (Web Lock conflict mints a fresh
 * attach token) gets a fresh pair, and explicit new-chat rotation
 * (`ptyAttachToken(true)`) rotates both.
 */

import { ptyAttachToken } from "./pty-attach-token";

export interface ChatTabPair {
  attach: string;
  channel: string;
}

/** Scope distinguishing PTY identities that share one base attach token. */
export function chatScopeKey(resumeParam: string | null, profile: string): string {
  return `${resumeParam ?? ""}\0${profile ?? ""}`;
}

/** FNV-1a 32-bit hash, hex-encoded — short scope suffix, no async needed. */
export function hashScope(scope: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < scope.length; i++) {
    hash ^= scope.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Deterministic channel for an attach token + scope. Pure so the invariant
 * (same pair in → same channel out; rotated attach or changed scope → new
 * channel) is testable without a browser.
 */
export function chatChannelForAttach(attach: string, scope: string): string {
  if (!scope) return `chat-${attach}`;
  return `chat-${attach}.${hashScope(scope)}`;
}

/**
 * Resolve this tab's PTY + events pair. `rotate` starts a fresh session: the
 * attach token rotates and the derived channel follows it.
 */
export async function resolveChatTabPair(
  scope: string,
  rotate = false,
): Promise<ChatTabPair> {
  const attach = await ptyAttachToken(rotate);
  return { attach, channel: chatChannelForAttach(attach, scope) };
}
