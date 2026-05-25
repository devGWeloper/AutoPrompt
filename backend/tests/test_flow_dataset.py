from __future__ import annotations

import pytest

from app.services import external_agent


@pytest.fixture
def ext(monkeypatch):
    """Enable external mode and stub the chat run_flow; record each call's args."""
    calls: list[dict] = []
    monkeypatch.setattr(external_agent, "external_enabled", lambda: True)

    async def fake_run_flow(*, message, session_system_prompt=None, main_model_name=None,
                            session_id=None, timeout_s=60.0):
        calls.append({
            "message": message,
            "session_system_prompt": session_system_prompt,
            "main_model_name": main_model_name,
        })
        return {"output": "ans:" + message}

    monkeypatch.setattr(external_agent, "run_flow", fake_run_flow)
    return calls


def _drain(ws, n: int = 60):
    msgs = []
    for _ in range(n):
        m = ws.receive_json()
        msgs.append(m)
        if m["event"] in ("DONE", "FAILED"):
            break
    return msgs


def _make_flow_dataset(client) -> int:
    did = client.post("/api/v1/flow/datasets", json={"dataset_nm": "flow ds"}).json()["dataset_id"]
    client.post(f"/api/v1/datasets/{did}/cases", json={"input_data": '{"question": "hi"}', "expected_output": "ans:hi"})
    client.post(f"/api/v1/datasets/{did}/cases", json={"input_data": '{"question": "bye"}', "expected_output": "nope"})
    return did


def test_flow_batch_runs_whole_flow_per_case(client, ext):
    did = _make_flow_dataset(client)
    run = client.post("/api/v1/flow/test/batch", json={"dataset_id": did}).json()
    assert run["run_type"] == "FLOW_BATCH"
    with client.websocket_connect(f"/ws/flow-runs/{run['run_id']}") as ws:
        msgs = _drain(ws)
    assert msgs[-1]["event"] == "DONE"

    detail = client.get(f"/api/v1/test-runs/{run['run_id']}").json()
    assert detail["status"] == "DONE"
    assert len(detail["results"]) == 2
    assert detail["passed_cases"] == 1 and detail["failed_cases"] == 1
    # batch runs the CURRENT flow → current main model on every call
    assert all(c["main_model_name"] == "claude-sonnet-4-6" for c in ext)
    # message is taken from each case's input ("question")
    assert {c["message"] for c in ext} == {"hi", "bye"}
    # each result exposes its case INPUT for visibility
    assert all(r["input_data"] for r in detail["results"])


def test_flow_ragas_records_error_when_external_disabled(client):
    """RUN_MODE=internal → flow RAGAS fails, but the error must be recorded (run + result row)."""
    did = _make_flow_dataset(client)
    run = client.post("/api/v1/flow/test/ragas", json={"dataset_id": did, "metrics": ["faithfulness"]}).json()
    rid = run["ragas_run_id"]
    with client.websocket_connect(f"/ws/ragas-runs/{rid}") as ws:
        msgs = _drain(ws)
    assert msgs[-1]["event"] == "FAILED"

    detail = client.get(f"/api/v1/ragas-runs/{rid}").json()
    assert detail["status"] == "FAILED"
    assert detail["error_msg"]
    assert len(detail["results"]) >= 1
    assert detail["results"][0]["error_msg"]


def test_flow_ab_compares_two_versions(client, ext):
    did = _make_flow_dataset(client)
    # cut a 2nd flow version by changing the main model
    client.put("/api/v1/flow/main-model", json={"main_model_nm": "gemini-2.5-flash"})
    versions = client.get("/api/v1/flow/versions").json()
    assert len(versions) >= 2
    va, vb = versions[0]["flow_ver_id"], versions[1]["flow_ver_id"]

    resp = client.post("/api/v1/flow/test/ab", json={"dataset_id": did, "flow_ver_a": va, "flow_ver_b": vb}).json()
    for rid in (resp["run_a_id"], resp["run_b_id"]):
        with client.websocket_connect(f"/ws/flow-runs/{rid}") as ws:
            _drain(ws)

    # each side runs with its own version's main model (no per-node overrides anymore)
    assert {c["main_model_name"] for c in ext} == {"gemini-2.5-flash", "claude-sonnet-4-6"}
    da = client.get(f"/api/v1/test-runs/{resp['run_a_id']}").json()
    db_ = client.get(f"/api/v1/test-runs/{resp['run_b_id']}").json()
    assert da["run_type"] == "FLOW_AB"
    assert len(da["results"]) == 2
    # both runs are tied by a shared ab_group_id (records UI shows them as one row)
    assert da["ab_group_id"] is not None
    assert da["ab_group_id"] == db_["ab_group_id"] == resp["run_a_id"]


def test_flow_ragas_nullable_node(client, ext):
    did = _make_flow_dataset(client)
    run = client.post("/api/v1/flow/test/ragas", json={"dataset_id": did, "metrics": ["faithfulness"]}).json()
    rid = run["ragas_run_id"]
    assert run["node_mas_id"] is None
    with client.websocket_connect(f"/ws/ragas-runs/{rid}") as ws:
        _drain(ws)
    detail = client.get(f"/api/v1/ragas-runs/{rid}").json()
    assert detail["status"] == "DONE"
    assert detail["node_mas_id"] is None
