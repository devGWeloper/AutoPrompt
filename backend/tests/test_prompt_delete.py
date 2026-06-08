"""Node add/delete + prompt-version delete API tests.

Uses the in-memory SQLite fixtures from conftest (FK enforcement is ON, so
FK-order bugs that would fail on Oracle are caught here too). The `client`
fixture seeds one node "llm" with one active version (1.0.0).
"""
from __future__ import annotations

import app.core.db as db_module
from app.models.dataset import TestDataset as DatasetModel
from app.models.node_prompt_ver import NodePromptVer
from app.models.ragas import RagasRun


def _new_version(client, node_nm, *, activate=False, prev_prompt_id=None):
    body = {
        "system_prompt": "sys",
        "user_prompt": "usr",
        "change_summary": "s",
        "change_reason": "r",
        "activate_after_save": activate,
    }
    if prev_prompt_id is not None:
        body["prev_prompt_id"] = prev_prompt_id
    res = client.post(f"/api/v1/nodes/{node_nm}/prompts", json=body)
    assert res.status_code == 201, res.text
    return res.json()


def _active_prompt_id(client, node_nm):
    rows = client.get(f"/api/v1/nodes/{node_nm}/prompts").json()
    return next(r["prompt_id"] for r in rows if r["is_active"] == "Y")


# ---- node create ------------------------------------------------------------

def test_create_node_new(client):
    res = client.post(
        "/api/v1/nodes",
        json={
            "node_nm": "router",
            "system_prompt": "sys",
            "user_prompt": "usr",
            "change_summary": "s",
            "change_reason": "r",
            "activate_after_save": True,
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["node_nm"] == "router"
    assert body["version_no"] == "1.0.0"
    assert body["is_active"] == "Y"

    nodes = {n["node_nm"] for n in client.get("/api/v1/flow/current").json()["nodes"]}
    assert "router" in nodes


def test_create_node_duplicate_conflicts(client):
    # "llm" is seeded.
    res = client.post(
        "/api/v1/nodes",
        json={"node_nm": "llm", "change_summary": "s", "change_reason": "r"},
    )
    assert res.status_code == 409, res.text


# ---- version delete ---------------------------------------------------------

def test_delete_inactive_version(client):
    created = _new_version(client, "llm")
    pid = created["prompt_id"]
    assert client.delete(f"/api/v1/prompts/{pid}").status_code == 204
    ids = {r["prompt_id"] for r in client.get("/api/v1/nodes/llm/prompts").json()}
    assert pid not in ids


def test_delete_active_version_blocked(client):
    pid = _active_prompt_id(client, "llm")
    assert client.delete(f"/api/v1/prompts/{pid}").status_code == 409


def test_delete_missing_version_404(client):
    assert client.delete("/api/v1/prompts/999999").status_code == 404


def test_delete_version_clears_prev_link(client):
    a = _new_version(client, "llm")
    b = _new_version(client, "llm", prev_prompt_id=a["prompt_id"])
    assert client.delete(f"/api/v1/prompts/{a['prompt_id']}").status_code == 204
    detail = client.get(f"/api/v1/prompts/{b['prompt_id']}").json()
    assert detail["prev_prompt_id"] is None


def test_delete_version_nulls_ragas_run(client):
    created = _new_version(client, "llm")
    pid = created["prompt_id"]

    s = db_module.SessionLocal()
    try:
        ds = DatasetModel(dataset_nm="ds", created_by="system")
        s.add(ds)
        s.flush()
        run = RagasRun(dataset_id=ds.dataset_id, prompt_id=pid, status="DONE", created_by="system")
        s.add(run)
        s.commit()
        run_id = run.ragas_run_id
    finally:
        s.close()

    assert client.delete(f"/api/v1/prompts/{pid}").status_code == 204

    s = db_module.SessionLocal()
    try:
        assert s.get(RagasRun, run_id).prompt_id is None
    finally:
        s.close()


# ---- node delete ------------------------------------------------------------

def test_delete_node(client):
    _new_version(client, "temp", activate=True)
    _new_version(client, "temp")
    assert client.delete("/api/v1/nodes/temp").status_code == 204

    nodes = {n["node_nm"] for n in client.get("/api/v1/flow/current").json()["nodes"]}
    assert "temp" not in nodes
    assert client.get("/api/v1/nodes/temp/prompts").json() == []

    s = db_module.SessionLocal()
    try:
        assert s.query(NodePromptVer).filter_by(node_nm="temp").count() == 0
    finally:
        s.close()


def test_delete_node_missing_404(client):
    assert client.delete("/api/v1/nodes/nope").status_code == 404
