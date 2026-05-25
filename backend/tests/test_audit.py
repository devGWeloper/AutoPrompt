from __future__ import annotations


def test_audit_log_written_on_create_and_activate(client):
    payload = {
        "system_prompt": "{{q}} audit-check",
        "change_summary": "audit check",
        "change_reason": "audit check",
        "model_nm": "claude-sonnet-4-6",
    }
    created = client.post("/api/v1/nodes/2/prompts", json=payload).json()
    client.put(f"/api/v1/prompts/{created['prompt_id']}/activate")

    logs = client.get(
        "/api/v1/audit-logs?target_table=PM_NODE_PROMPT_VER&page=1&size=20",
    ).json()
    actions = [item["action"] for item in logs["items"]]
    assert "CREATE" in actions
    assert "ACTIVATE" in actions

    # before/after must be populated for ACTIVATE
    activate_log = next(item for item in logs["items"] if item["action"] == "ACTIVATE")
    assert activate_log["before_value"] is not None
    assert activate_log["after_value"] is not None

    # a node prompt activation also cuts a whole-flow version (audited).
    flow_logs = client.get("/api/v1/audit-logs?target_table=PM_FLOW_VER").json()
    assert any(item["action"] == "FLOW_VERSION" for item in flow_logs["items"])
