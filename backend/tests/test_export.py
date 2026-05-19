from __future__ import annotations


def _run_batch(client) -> int:
    ds = client.post("/api/v1/nodes/2/datasets", json={"dataset_nm": "exp"}).json()
    did = ds["dataset_id"]
    client.post(
        f"/api/v1/datasets/{did}/cases",
        json={"input_data": '{"q": "hi"}', "expected_output": "STUB::Question: hi"},
    )
    out = client.post(
        "/api/v1/nodes/2/test/batch", json={"prompt_id": 1, "dataset_id": did}
    ).json()
    rid = out["run_id"]
    with client.websocket_connect(f"/ws/test-runs/{rid}") as ws:
        for _ in range(20):
            if ws.receive_json()["event"] in ("DONE", "FAILED"):
                break
    return rid


def test_export_test_run_csv(client, stub_llm):
    rid = _run_batch(client)
    r = client.get(f"/api/v1/test-runs/{rid}/export?fmt=csv")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    text = r.content.decode("utf-8-sig")
    assert "result_id" in text.splitlines()[0]


def test_export_test_run_xlsx(client, stub_llm):
    rid = _run_batch(client)
    r = client.get(f"/api/v1/test-runs/{rid}/export?fmt=xlsx")
    assert r.status_code == 200
    # XLSX is a zip archive -> starts with PK signature
    assert r.content[:2] == b"PK"


def test_export_bad_format_422(client, stub_llm):
    rid = _run_batch(client)
    r = client.get(f"/api/v1/test-runs/{rid}/export?fmt=pdf")
    assert r.status_code == 422  # blocked by query pattern


def test_export_unknown_run_404(client):
    r = client.get("/api/v1/test-runs/9999/export?fmt=csv")
    assert r.status_code == 404
