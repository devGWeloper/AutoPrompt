from __future__ import annotations

from app.core import db as db_module
from app.models.node_mas import NodeMas

MODEL = {"model_nm": "claude-sonnet-4-6"}
# seeded llm node = NODE_MAS id 2; start = id 1 (no prompt); seeded prompt_id 1.


def test_list_prompts(client):
    resp = client.get("/api/v1/nodes/2/prompts")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 1
    assert rows[0]["is_active"] == "Y"
    assert rows[0]["version_no"] == "1.0.0"
    assert rows[0]["node_nm"] == "llm"
    assert rows[0]["model_nm"] == "claude-sonnet-4-6"


def test_create_prompt_auto_bumps_patch(client):
    payload = {
        "system_prompt": "You are helpful.",
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
    assert body["system_prompt"] == "You are helpful."
    assert body["user_prompt"] == "Q: {{q}} (lang={{lang}})"


def test_create_prompt_on_non_prompt_node_400(client):
    # node 1 = 'start', PROMPT_EDIT_ENABLE_YN = 'N'
    resp = client.post(
        "/api/v1/nodes/1/prompts",
        json={"system_prompt": "x", "change_summary": "s", "change_reason": "r", **MODEL},
    )
    assert resp.status_code == 400


def test_activate_switches_active_flag(client):
    payload = {"system_prompt": "{{q}} rev", "change_summary": "rev", "change_reason": "rev", **MODEL}
    created = client.post("/api/v1/nodes/2/prompts", json=payload).json()
    new_id = created["prompt_id"]

    act = client.put(f"/api/v1/prompts/{new_id}/activate")
    assert act.status_code == 200
    assert act.json()["is_active"] == "Y"

    rows = client.get("/api/v1/nodes/2/prompts").json()
    active_rows = [r for r in rows if r["is_active"] == "Y"]
    assert len(active_rows) == 1
    assert active_rows[0]["prompt_id"] == new_id


def test_activate_writes_nodemas_and_bumps_flow_version(client):
    # before: flow at 1.0.0
    assert client.get("/api/v1/flow/current").json()["flow_version_no"] == "1.0.0"

    payload = {
        "system_prompt": "BRAND NEW PROMPT {{q}}",
        "user_prompt": "Q: {{q}}",
        "change_summary": "rewrite",
        "change_reason": "rewrite",
        **MODEL,
    }
    created = client.post("/api/v1/nodes/2/prompts", json=payload).json()
    client.put(f"/api/v1/prompts/{created['prompt_id']}/activate")

    # (1) NODE_MAS.PROMPT mirrors the activated SYSTEM_PROMPT (operational reflection).
    s = db_module.SessionLocal()
    try:
        node = s.get(NodeMas, 2)
        assert node.prompt == "BRAND NEW PROMPT {{q}}"
        assert node.update_user == "system"
        assert node.update_date is not None
    finally:
        s.close()

    # (2) whole-flow version bumped 1.0.0 -> 1.0.1
    cur = client.get("/api/v1/flow/current").json()
    assert cur["flow_version_no"] == "1.0.1"
    versions = client.get("/api/v1/flow/versions").json()
    assert [v["flow_version_no"] for v in versions] == ["1.0.1", "1.0.0"]
    active = [v for v in versions if v["is_active"] == "Y"]
    assert len(active) == 1 and active[0]["flow_version_no"] == "1.0.1"


def test_diff_endpoint(client):
    # seeded v1 system_prompt = "You are helpful." → diff against new system text.
    payload = {
        "system_prompt": "You are extra helpful.\nQ: {{q}}",
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
    assert "user_prompt" in body


def test_rollback_via_activate(client):
    payload = {
        "system_prompt": "{{q}} v2",
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
