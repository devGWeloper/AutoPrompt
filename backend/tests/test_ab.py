from __future__ import annotations

MODEL = {"model_provider": "anthropic", "model_nm": "claude-sonnet-4-6"}


def test_ab_runs_two_versions(client, stub_llm):
    # second prompt version on node 2 (seeded prompt_id 1 is the first)
    v2 = client.post(
        "/api/v1/nodes/2/prompts",
        json={
            "system_prompt": "v2",
            "user_prompt": "Q: {{q}}",
            "change_summary": "v2",
            "change_reason": "v2",
            **MODEL,
        },
    ).json()
    ds = client.post("/api/v1/nodes/2/datasets", json={"dataset_nm": "ab"}).json()
    did = ds["dataset_id"]
    client.post(
        f"/api/v1/datasets/{did}/cases",
        json={"input_data": '{"q": "hi"}', "expected_output": "STUB"},
    )

    resp = client.post(
        "/api/v1/nodes/2/test/ab",
        json={"prompt_id_a": 1, "prompt_id_b": v2["prompt_id"], "dataset_id": did},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    a, b = body["run_a_id"], body["run_b_id"]
    assert a != b

    for rid, pid in ((a, 1), (b, v2["prompt_id"])):
        detail = client.get(f"/api/v1/test-runs/{rid}").json()
        assert detail["status"] == "DONE"
        assert detail["run_type"] == "AB"
        assert detail["prompt_id"] == pid
        assert detail["total_cases"] == 1
        # expected "STUB" is a substring of "STUB::..." -> pass
        assert detail["passed_cases"] == 1
