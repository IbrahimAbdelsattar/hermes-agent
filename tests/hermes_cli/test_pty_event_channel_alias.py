"""Reattached chat tabs still hear the PTY child's event frames.

Regression for the dashboard /chat silent-reply bug: the PTY child publishes
``message.start/delta/complete`` to the channel it was spawned with, but a
reload used to subscribe the sidebar/voice controls to a fresh random channel
while reusing the attach token — so the reply arrived in the terminal and
never spoke. ``pty_ws`` now records the reattached tab's channel as a
subscriber alias scoped to that PTY session, and the /api/pub fan-out delivers
old-publisher frames to it.
"""

import pytest

import hermes_cli.web_server_chat as chat_mod
from hermes_cli import web_server


class _FakeBridge:
    def read(self, timeout):
        return b""

    async def write(self, data):
        return True

    def resize(self, cols, rows):
        pass

    def close(self):
        pass


@pytest.fixture
def alias_harness(monkeypatch):
    def fake_spawn(argv, cwd=None, env=None):
        return _FakeBridge()

    async def fake_argv(**kw):
        return (["x"], "/tmp", {})

    monkeypatch.setattr(chat_mod.PtyBridge, "spawn", staticmethod(fake_spawn))
    monkeypatch.setattr(chat_mod, "_resolve_chat_argv_async", fake_argv)
    try:
        yield
    finally:
        chat_mod.PTY_REGISTRY._sessions.clear()
        try:
            event_channels = web_server.app.state.event_channels
        except AttributeError:
            pass
        else:
            event_channels.clear()


def test_reattached_tab_receives_old_publisher_frames(alias_harness):
    """An old publisher frame reaches the reattached tab after C1 -> C2."""
    from starlette.testclient import TestClient

    token = web_server._SESSION_TOKEN
    client = TestClient(web_server.app)
    attach = "alias-tok-reattach"
    old_channel = "alias-c1-old"
    new_channel = "alias-c2-new"
    other_attach = "alias-tok-other"
    other_channel = "alias-c3-lonely"
    frame = '{"type":"message.complete","payload":{"text":"hello"}}'

    with client.websocket_connect(
        f"/api/pty?token={token}&attach={attach}&channel={old_channel}"
    ):
        pass
    with client.websocket_connect(
        f"/api/pty?token={token}&attach={attach}&channel={new_channel}"
    ) as reattached_pty:
        with client.websocket_connect(
            f"/api/pty?token={token}&attach={other_attach}&channel={other_channel}"
        ):
            pass
        with client.websocket_connect(
            f"/api/events?token={token}&channel={new_channel}"
        ) as sub_new:
            with client.websocket_connect(
                f"/api/pub?token={token}&channel={old_channel}"
            ) as pub_old:
                pub_old.send_text(frame)
                assert sub_new.receive_text() == frame
        # Alias never crosses attach tokens: the independent session recorded
        # no alias for the old publisher channel.
        assert chat_mod.PTY_REGISTRY.aliases_for(old_channel) == [new_channel]
        other_session = chat_mod.PTY_REGISTRY._sessions[other_attach]
        assert other_session.pub_channel == other_channel
        assert other_session.aliases == set()
