from __future__ import annotations

import pytest

from app.core.ws import manager


@pytest.fixture(autouse=True)
def _reset_ws_manager():
    manager._connections.clear()
    manager._history.clear()
    yield
    manager._connections.clear()
    manager._history.clear()


def test_single_run_streams_over_ws(client, stub_llm):
    resp = client.post(
        "/api/v1/nodes/2/test/run",
        json={"prompt_id": 1, "variables": {"q": "hello"}},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "PENDING"
    run_id = body["run_id"]

    with client.websocket_connect(f"/ws/test-runs/{run_id}") as ws:
        events = [ws.receive_json(), ws.receive_json()]

    kinds = [e["event"] for e in events]
    assert kinds == ["RUNNING", "DONE"]
    done = events[1]
    # stub echoes the rendered USER prompt ("Question: {{q}}" -> "Question: hello")
    assert done["result"]["actual_output"] == "STUB::Question: hello"
    assert done["result"]["input_tokens"] == 3
    assert done["result"]["output_tokens"] == 5


def test_single_run_unknown_prompt_404(client, stub_llm):
    resp = client.post(
        "/api/v1/nodes/2/test/run",
        json={"prompt_id": 9999, "variables": {}},
    )
    assert resp.status_code == 404
