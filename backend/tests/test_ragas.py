"""Flow-level RAGAS (the only test path): dataset -> stub flow answer -> score.

Forces the deterministic FALLBACK scorer and the in-process stub agent so the
whole pipeline runs offline (no LLM, no external endpoint).
"""
from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    # FALLBACK scorer (no judge LLM / network) + stub flow answer (no external agent).
    monkeypatch.setattr("app.services.ragas.ragas_importable", lambda: False)
    monkeypatch.setattr("app.services.external_agent.external_enabled", lambda: False)


def _drain(ws, max_msgs: int = 30) -> list[dict]:
    msgs: list[dict] = []
    for _ in range(max_msgs):
        m = ws.receive_json()
        msgs.append(m)
        if m["event"] in ("DONE", "FAILED"):
            break
    return msgs


def _seed_dataset(client) -> int:
    ds = client.post("/api/v1/flow/datasets", json={"dataset_nm": "ragas-ds"}).json()
    did = ds["dataset_id"]
    client.post(
        f"/api/v1/datasets/{did}/cases",
        json={
            "input_data": (
                '{"question": "say hello", "contexts": ["hello there"], '
                '"ground_truth": "stub answer say hello"}'
            )
        },
    )
    client.post(
        f"/api/v1/datasets/{did}/cases",
        json={
            "input_data": '{"question": "world", "contexts": ["world"]}',
            "expected_output": "stub answer world",
        },
    )
    return did


def test_flow_ragas_run_fallback_scores(client):
    did = _seed_dataset(client)
    resp = client.post("/api/v1/flow/test/ragas", json={"dataset_id": did})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "PENDING"
    rid = body["ragas_run_id"]

    with client.websocket_connect(f"/ws/ragas-runs/{rid}") as ws:
        msgs = _drain(ws)
    done = msgs[-1]
    assert done["event"] == "DONE"
    assert done["engine"] == "FALLBACK"
    assert done["summary"]["faithfulness"] is not None

    detail = client.get(f"/api/v1/ragas-runs/{rid}").json()
    assert detail["status"] == "DONE"
    assert detail["engine"] == "FALLBACK"
    assert len(detail["results"]) == 2
    for r in detail["results"]:
        # answer came from the stub agent, then was scored by the fallback engine
        assert r["answer"].startswith("[stub answer]")
        f = float(r["faithfulness"])
        assert 0.0 <= f <= 1.0

    runs = client.get("/api/v1/ragas-runs").json()
    assert any(x["ragas_run_id"] == rid for x in runs)


def test_flow_ragas_sets_test_flag_on_start(client, monkeypatch):
    # Posting a run turns the global TEST flag on. Stub the background execution
    # so the run stays in-flight and the flag isn't immediately cleared again.
    async def _noop(**_kwargs):
        return None

    monkeypatch.setattr("app.services.flow_service.execute_flow_ragas_run", _noop)

    did = _seed_dataset(client)
    assert client.get("/api/v1/system-config").json() == {"enabled_yn": "N"}
    client.post("/api/v1/flow/test/ragas", json={"dataset_id": did})
    assert client.get("/api/v1/system-config").json() == {"enabled_yn": "Y"}


def test_flow_ragas_clears_test_flag_when_done(client):
    # A completed run leaves the flag off again (cleared by execute's finally).
    did = _seed_dataset(client)
    resp = client.post("/api/v1/flow/test/ragas", json={"dataset_id": did})
    rid = resp.json()["ragas_run_id"]
    with client.websocket_connect(f"/ws/ragas-runs/{rid}") as ws:
        assert _drain(ws)[-1]["event"] == "DONE"
    assert client.get("/api/v1/system-config").json() == {"enabled_yn": "N"}


def test_flow_ragas_unknown_dataset_404(client):
    resp = client.post("/api/v1/flow/test/ragas", json={"dataset_id": 9999})
    assert resp.status_code == 404


def test_flow_ragas_metric_subset_only(client):
    did = _seed_dataset(client)
    resp = client.post(
        "/api/v1/flow/test/ragas", json={"dataset_id": did, "metrics": ["faithfulness"]}
    )
    rid = resp.json()["ragas_run_id"]
    with client.websocket_connect(f"/ws/ragas-runs/{rid}") as ws:
        _drain(ws)
    detail = client.get(f"/api/v1/ragas-runs/{rid}").json()
    assert detail["faithfulness"] is not None
    assert detail["answer_relevancy"] is None
    for r in detail["results"]:
        assert r["answer_relevancy"] is None


def test_flow_ragas_ab_two_versions(client):
    did = _seed_dataset(client)
    # seed: node_nm="llm" with prompt_id 1 (v1.0.0, active). Make a second version for it.
    created = client.post(
        "/api/v1/nodes/llm/prompts",
        json={
            "system_prompt": "You are concise.", "user_prompt": "Q: {{q}}",
            "change_summary": "concise variant", "change_reason": "ab test",
        },
    ).json()
    pid_b = created["prompt_id"]

    resp = client.post(
        "/api/v1/flow/test/ragas/ab",
        json={"dataset_id": did, "node_nm": "llm", "prompt_id_a": 1, "prompt_id_b": pid_b},
    )
    assert resp.status_code == 200, resp.text
    a_id, b_id = resp.json()["ragas_run_a_id"], resp.json()["ragas_run_b_id"]

    for rid in (a_id, b_id):
        with client.websocket_connect(f"/ws/ragas-runs/{rid}") as ws:
            done = _drain(ws)[-1]
            assert done["event"] == "DONE"

    da = client.get(f"/api/v1/ragas-runs/{a_id}").json()
    db = client.get(f"/api/v1/ragas-runs/{b_id}").json()
    assert da["status"] == "DONE" and db["status"] == "DONE"
    # both runs of the comparison share the A run's id as group, and carry their version
    assert da["ab_group_id"] == a_id and db["ab_group_id"] == a_id
    assert da["prompt_id"] == 1 and db["prompt_id"] == pid_b
    assert da["version_no"] and db["version_no"]
    assert da["node_nm"] == "llm" and db["node_nm"] == "llm"

    # records list pairs them under one ab_group_id
    runs = client.get("/api/v1/ragas-runs").json()
    pair = [r for r in runs if r["ab_group_id"] == a_id]
    assert len(pair) == 2


def test_flow_ragas_ab_bad_prompt_node_404(client):
    did = _seed_dataset(client)
    # prompt_id 1 belongs to node "llm", not node "ghost"
    resp = client.post(
        "/api/v1/flow/test/ragas/ab",
        json={"dataset_id": did, "node_nm": "ghost", "prompt_id_a": 1, "prompt_id_b": 9999},
    )
    assert resp.status_code == 404
