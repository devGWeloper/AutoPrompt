from __future__ import annotations

import pytest

from app.services import external_agent


def _drain(ws, max_msgs: int = 40) -> list[dict]:
    msgs: list[dict] = []
    for _ in range(max_msgs):
        m = ws.receive_json()
        msgs.append(m)
        if m["event"] in ("DONE", "FAILED"):
            break
    return msgs


def test_flow_test_requires_external_mode(client):
    """Default RUN_MODE=internal: the full flow test fails fast with a clear error."""
    resp = client.post("/api/v1/flow/test/run", json={"inputs": {"question": "hi"}})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["run_type"] == "FLOW"
    run_id = body["run_id"]

    with client.websocket_connect(f"/ws/flow-runs/{run_id}") as ws:
        msgs = _drain(ws)
    assert msgs[0]["event"] == "RUNNING"
    assert msgs[-1]["event"] == "FAILED"

    detail = client.get(f"/api/v1/test-runs/{run_id}").json()
    assert detail["status"] == "FAILED"


def test_flow_test_external_returns_answer(client, monkeypatch):
    """With the external model enabled, the flow test stores the chat answer.

    The managed system prompt rides in session_system_prompt; the test input
    becomes message; the response is a single answer (no per-node trace).
    """
    monkeypatch.setattr(external_agent, "external_enabled", lambda: True)
    captured: dict = {}

    async def fake_run_flow(*, message, session_system_prompt=None, main_model_name=None,
                            session_id=None, timeout_s=60.0):
        captured.update(
            message=message,
            session_system_prompt=session_system_prompt,
            main_model_name=main_model_name,
        )
        return {"output": "final answer"}

    monkeypatch.setattr(external_agent, "run_flow", fake_run_flow)

    resp = client.post("/api/v1/flow/test/run", json={"inputs": {"question": "hi"}})
    run_id = resp.json()["run_id"]

    with client.websocket_connect(f"/ws/flow-runs/{run_id}") as ws:
        msgs = _drain(ws)

    events = [m["event"] for m in msgs]
    assert events[0] == "RUNNING"
    assert events[-1] == "DONE"
    assert msgs[-1]["output"] == "final answer"

    # message = the input; system prompt = the activated SYSTEM_PROMPT; model = flow main model
    assert captured["message"] == "hi"
    assert captured["session_system_prompt"] == "You are helpful."
    assert captured["main_model_name"] == "claude-sonnet-4-6"

    detail = client.get(f"/api/v1/test-runs/{run_id}").json()
    assert detail["status"] == "DONE"
    assert detail["total_cases"] == 1
    assert len(detail["results"]) == 1
    assert detail["results"][0]["actual_output"] == "final answer"


def test_flow_ragas_failure_listed_in_records(client, monkeypatch):
    """A FLOW-scoped RAGAS run (prompt_id=None) that FAILS must still show up in
    GET /ragas-runs with its error_msg.

    Regression: RagasRunSummary.prompt_id was a required int, so serializing a
    flow run (prompt_id None) raised → /ragas-runs 500'd → the UI silently dropped
    every RAGAS run, so failures never appeared in 실행기록.
    """
    monkeypatch.setattr("app.services.ragas.ragas_importable", lambda: False)

    ds = client.post("/api/v1/flow/datasets", json={"dataset_nm": "flow-ragas"}).json()
    did = ds["dataset_id"]

    # RUN_MODE=internal -> flow RAGAS fails fast and records the failure.
    resp = client.post("/api/v1/flow/test/ragas", json={"dataset_id": did})
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["prompt_id"] is None  # flow-scoped: no single prompt target
    rid = out["ragas_run_id"]

    with client.websocket_connect(f"/ws/ragas-runs/{rid}") as ws:
        msgs = _drain(ws)
    assert msgs[-1]["event"] == "FAILED"

    # the records list must serialize (no 500) and surface the error.
    runs = client.get("/api/v1/ragas-runs")
    assert runs.status_code == 200, runs.text
    row = next(r for r in runs.json() if r["ragas_run_id"] == rid)
    assert row["status"] == "FAILED"
    assert row["prompt_id"] is None
    assert row["error_msg"]
