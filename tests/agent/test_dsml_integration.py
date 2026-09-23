"""Integration test for DSML normalization in ChatCompletionsTransport."""

from types import SimpleNamespace
from agent.transports.chat_completions import ChatCompletionsTransport


def test_chat_completions_normalizes_dsml_tool_calls():
    raw_dsml = """<｜｜DSML｜｜ calls>
    <｜｜DSML｜｜ invoke name="skill_view">
    <｜｜DSML｜｜ parameter name="name" string="true">google-workspace</｜｜DSML｜｜ parameter>
    </｜｜DSML｜｜ invoke>
    <｜｜DSML｜｜ invoke name="terminal">
    <｜｜DSML｜｜ parameter name="command" string="true">which gws; ls -la ~/.gws</｜｜DSML｜｜ parameter>
    </｜｜DSML｜｜ invoke>
</｜｜DSML｜｜ calls>"""

    transport = ChatCompletionsTransport()

    # Simulate an OpenAI API response where the model emitted DSML inside message.content
    # and tool_calls is None
    fake_message = SimpleNamespace(
        role="assistant",
        content=raw_dsml,
        tool_calls=None,
    )
    fake_choice = SimpleNamespace(
        index=0,
        message=fake_message,
        finish_reason="stop",
    )
    fake_response = SimpleNamespace(
        id="resp-123",
        choices=[fake_choice],
        usage=None,
    )

    normalized = transport.normalize_response(fake_response)

    # 1. Tool calls must be extracted
    assert normalized.tool_calls is not None
    assert len(normalized.tool_calls) == 2
    assert normalized.tool_calls[0].name == "skill_view"
    assert '"google-workspace"' in normalized.tool_calls[0].arguments

    assert normalized.tool_calls[1].name == "terminal"
    assert "which gws" in normalized.tool_calls[1].arguments

    # 2. Finish reason should be converted to tool_calls
    assert normalized.finish_reason == "tool_calls"

    # 3. Content should be None or stripped of DSML
    assert normalized.content is None
