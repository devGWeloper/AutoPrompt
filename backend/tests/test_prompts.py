from __future__ import annotations

MODEL = {"model_provider": "anthropic", "model_nm": "claude-sonnet-4-6"}


def test_list_prompts(client):
    resp = client.get("/api/v1/nodes/2/prompts")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 1
    assert rows[0]["is_active"] == "Y"
    assert rows[0]["version_no"] == "1.0.0"
    assert rows[0]["model_provider"] == "anthropic"


def test_create_prompt_auto_bumps_patch(client):
    payload = {
        "system_prompt": "You are very helpful.",
        "user_prompt": "Q: {{q}} (lang={{lang}})",
        "change_summary": "tone adjustment",
        "change_reason": "user requested friendlier tone",
        **MODEL,
        "temperature": 0.4,
    }
    resp = client.post("/api/v1/nodes/2/prompts", json=payload)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["version_no"] == "1.0.1"
    assert body["is_active"] == "N"
    assert body["model_nm"] == "claude-sonnet-4-6"
    var_names = {v["var_name"] for v in body["variables"]}
    assert var_names == {"q", "lang"}


def test_create_prompt_requires_model(client):
    resp = client.post(
        "/api/v1/nodes/2/prompts",
        json={
            "system_prompt": "x",
            "user_prompt": "y",
            "change_summary": "s",
            "change_reason": "r",
        },
    )
    assert resp.status_code == 422  # model_provider / model_nm required


def test_activate_switches_active_flag(client):
    payload = {
        "system_prompt": "rev",
        "user_prompt": "{{q}}",
        "change_summary": "rev",
        "change_reason": "rev",
        **MODEL,
    }
    created = client.post("/api/v1/nodes/2/prompts", json=payload).json()
    new_id = created["prompt_id"]

    act = client.put(f"/api/v1/prompts/{new_id}/activate")
    assert act.status_code == 200
    assert act.json()["is_active"] == "Y"

    rows = client.get("/api/v1/nodes/2/prompts").json()
    active_rows = [r for r in rows if r["is_active"] == "Y"]
    assert len(active_rows) == 1
    assert active_rows[0]["prompt_id"] == new_id


def test_diff_endpoint(client):
    payload = {
        "system_prompt": "You are extra helpful.",
        "user_prompt": "Q: {{q}}",
        "change_summary": "wording",
        "change_reason": "wording",
        **MODEL,
    }
    created = client.post("/api/v1/nodes/2/prompts", json=payload).json()
    resp = client.get(f"/api/v1/prompts/diff?v1=1&v2={created['prompt_id']}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["system_prompt"]["added"] >= 1
    assert body["system_prompt"]["removed"] >= 1


def test_rollback_via_activate(client):
    payload = {
        "system_prompt": "v2",
        "user_prompt": "{{q}}",
        "change_summary": "v2",
        "change_reason": "v2",
        "activate_after_save": True,
        **MODEL,
    }
    v2 = client.post("/api/v1/nodes/2/prompts", json=payload).json()
    assert v2["is_active"] == "Y"
    rollback = client.put("/api/v1/prompts/1/activate")
    assert rollback.status_code == 200
    assert rollback.json()["is_active"] == "Y"
