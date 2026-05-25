"""Active-prompts read API (inspection / agent compat), keyed by NODE_NM."""
from __future__ import annotations


def test_active_prompts_bulk_keyed_by_node_nm(client):
    resp = client.get("/api/v1/active-prompts")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # 'llm' has an active prompt; 'start'/'done' have none -> omitted.
    assert set(body) == {"llm"}
    ap = body["llm"]
    assert ap["node_nm"] == "llm"
    assert ap["version_no"] == "1.0.0"
    assert ap["model_nm"] == "claude-sonnet-4-6"
    assert ap["system_prompt"] == "You are helpful."
    assert ap["user_prompt"] == "Question: {{q}}"


def test_active_prompt_by_name(client):
    resp = client.get("/api/v1/nodes/by-name/llm/active-prompt")
    assert resp.status_code == 200, resp.text
    ap = resp.json()
    assert ap["node_nm"] == "llm"
    assert ap["prompt_id"]
    assert ap["model_nm"] == "claude-sonnet-4-6"


def test_active_prompt_by_name_node_without_active(client):
    # 'start' node exists but has no active prompt version.
    resp = client.get("/api/v1/nodes/by-name/start/active-prompt")
    assert resp.status_code == 404


def test_active_prompt_by_name_unknown_node(client):
    resp = client.get("/api/v1/nodes/by-name/does-not-exist/active-prompt")
    assert resp.status_code == 404
