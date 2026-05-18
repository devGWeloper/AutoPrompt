from __future__ import annotations


def _drain(ws, max_msgs: int = 40) -> list[dict]:
    msgs: list[dict] = []
    for _ in range(max_msgs):
        m = ws.receive_json()
        msgs.append(m)
        if m["event"] in ("DONE", "FAILED"):
            break
    return msgs


def test_flow_run_executes_graph(client, stub_llm):
    # seeded project 1: node 1 (start, no prompt) -> node 2 (llm, active prompt
    # user_prompt "Question: {{q}}").
    resp = client.post(
        "/api/v1/projects/1/flow/run", json={"variables": {"q": "hi"}}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["run_type"] == "FLOW"
    assert body["status"] == "PENDING"
    run_id = body["run_id"]

    with client.websocket_connect(f"/ws/flow-runs/{run_id}") as ws:
        msgs = _drain(ws)

    events = [m["event"] for m in msgs]
    assert events[0] == "RUNNING"
    assert events[-1] == "DONE"
    node_done = [m for m in msgs if m["event"] == "NODE_DONE"]
    # node 1 skipped (no prompt), node 2 produces stub output
    skipped = [m for m in node_done if m.get("skipped")]
    ran = [m for m in node_done if not m.get("skipped")]
    assert len(skipped) == 1
    assert len(ran) == 1
    assert ran[0]["output"] == "STUB::Question: hi"
    assert msgs[-1]["summary"]["nodes_executed"] == 1

    detail = client.get(f"/api/v1/test-runs/{run_id}").json()
    assert detail["status"] == "DONE"
    assert detail["run_type"] == "FLOW"


def test_flow_unknown_project_404(client, stub_llm):
    resp = client.post("/api/v1/projects/9999/flow/run", json={"variables": {}})
    assert resp.status_code == 404
