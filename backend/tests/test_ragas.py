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
