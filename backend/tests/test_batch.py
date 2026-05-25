from __future__ import annotations


def _drain(ws, max_msgs: int = 30) -> list[dict]:
    msgs: list[dict] = []
    for _ in range(max_msgs):
        m = ws.receive_json()
        msgs.append(m)
        if m["event"] in ("DONE", "FAILED"):
            break
    return msgs


def test_batch_run_aggregates_pass_fail(client, stub_llm):
    ds = client.post(
        "/api/v1/nodes/2/datasets", json={"dataset_nm": "golden"}
    ).json()
    did = ds["dataset_id"]
    # seeded prompt_id 1 user_prompt = "Question: {{q}}" -> stub echoes rendered user prompt
    client.post(
        f"/api/v1/datasets/{did}/cases",
        json={
            "input_data": '{"q": "hello"}',
            "expected_output": "STUB::Question: hello",
        },
    )
    client.post(
        f"/api/v1/datasets/{did}/cases",
        json={"input_data": '{"q": "world"}', "expected_output": "nope"},
    )
    client.post(
        f"/api/v1/datasets/{did}/cases",
        json={"input_data": '{"q": "x"}'},  # no expected -> unscored
    )

    resp = client.post(
        "/api/v1/nodes/2/test/batch", json={"prompt_id": 1, "dataset_id": did}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "PENDING"
    assert body["total_cases"] == 3
    run_id = body["run_id"]

    with client.websocket_connect(f"/ws/test-runs/{run_id}") as ws:
        msgs = _drain(ws)
    done = msgs[-1]
    assert done["event"] == "DONE"
    assert done["summary"]["total"] == 3
    assert done["summary"]["passed"] == 1
    assert done["summary"]["failed"] == 1

    detail = client.get(f"/api/v1/test-runs/{run_id}").json()
    assert detail["status"] == "DONE"
    assert detail["passed_cases"] == 1
    assert detail["failed_cases"] == 1
    assert detail["total_cases"] == 3
    assert len(detail["results"]) == 3

    results = client.get(f"/api/v1/test-runs/{run_id}/results").json()
    assert len(results) == 3


def test_batch_unknown_dataset_404(client, stub_llm):
    resp = client.post(
        "/api/v1/nodes/2/test/batch", json={"prompt_id": 1, "dataset_id": 9999}
    )
    assert resp.status_code == 404
