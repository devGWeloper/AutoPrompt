from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _force_fallback(monkeypatch):
    """These tests assert the deterministic FALLBACK scorer.

    `ragas` is now a declared dependency and .env may carry a provider key,
    so get_scorer() would otherwise pick the real RAGAS engine (network).
    Force the import probe False so selection stays on FallbackScorer.
    """
    monkeypatch.setattr("app.services.ragas.ragas_importable", lambda: False)


def _drain(ws, max_msgs: int = 30) -> list[dict]:
    msgs: list[dict] = []
    for _ in range(max_msgs):
        m = ws.receive_json()
        msgs.append(m)
        if m["event"] in ("DONE", "FAILED"):
            break
    return msgs


def _seed_dataset(client) -> int:
    ds = client.post("/api/v1/nodes/2/datasets", json={"dataset_nm": "ragas-ds"}).json()
    did = ds["dataset_id"]
    # seeded prompt 1 user_prompt = "Question: {{q}}" -> stub "STUB::Question: hello"
    client.post(
        f"/api/v1/datasets/{did}/cases",
        json={
            "input_data": (
                '{"q": "hello", "question": "say hello", '
                '"contexts": ["hello there"], "ground_truth": "STUB Question hello"}'
            )
        },
    )
    client.post(
        f"/api/v1/datasets/{did}/cases",
        json={
            "input_data": '{"q": "world", "question": "world", "contexts": ["w"]}',
            "expected_output": "STUB Question world",
        },
    )
    return did


def test_ragas_run_fallback_scores(client, stub_llm):
    did = _seed_dataset(client)
    resp = client.post(
        "/api/v1/nodes/2/ragas/run",
        json={"prompt_id": 1, "dataset_id": did},
    )
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
        f = float(r["faithfulness"])
        assert 0.0 <= f <= 1.0

    hist = client.get("/api/v1/nodes/2/ragas-runs").json()
    assert len(hist) == 1
    assert hist[0]["ragas_run_id"] == rid


def test_ragas_unknown_dataset_404(client, stub_llm):
    resp = client.post(
        "/api/v1/nodes/2/ragas/run", json={"prompt_id": 1, "dataset_id": 9999}
    )
    assert resp.status_code == 404


def test_ragas_metric_subset_only(client, stub_llm):
    did = _seed_dataset(client)
    resp = client.post(
        "/api/v1/nodes/2/ragas/run",
        json={"prompt_id": 1, "dataset_id": did, "metrics": ["faithfulness"]},
    )
    rid = resp.json()["ragas_run_id"]
    with client.websocket_connect(f"/ws/ragas-runs/{rid}") as ws:
        _drain(ws)
    detail = client.get(f"/api/v1/ragas-runs/{rid}").json()
    assert detail["faithfulness"] is not None
    assert detail["answer_relevancy"] is None
    for r in detail["results"]:
        assert r["answer_relevancy"] is None
