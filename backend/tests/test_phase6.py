from __future__ import annotations

MODEL = {"model_nm": "claude-sonnet-4-6"}


def test_list_models(client):
    models = client.get("/api/v1/flow/models").json()
    assert "claude-sonnet-4-6" in models
    assert "gemini-2.5-flash" in models


def test_set_main_model_bumps_flow_version(client):
    cur = client.get("/api/v1/flow/current").json()
    assert cur["main_model_editable"] is True
    assert cur["main_model_nm"] == "claude-sonnet-4-6"
    assert cur["flow_version_no"] == "1.0.0"

    resp = client.put("/api/v1/flow/main-model", json={"main_model_nm": "gemini-2.5-flash"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["main_model_nm"] == "gemini-2.5-flash"
    assert body["flow_version_no"] == "1.0.1"

    versions = client.get("/api/v1/flow/versions").json()
    assert [v["flow_version_no"] for v in versions] == ["1.0.1", "1.0.0"]
    detail = client.get(f"/api/v1/flow/versions/{versions[0]['flow_ver_id']}").json()
    assert detail["main_model_nm"] == "gemini-2.5-flash"


def test_set_main_model_invalid_400(client):
    resp = client.put("/api/v1/flow/main-model", json={"main_model_nm": "no-such-model"})
    assert resp.status_code == 400


def test_edit_inactive_version(client):
    created = client.post(
        "/api/v1/nodes/2/prompts",
        json={"system_prompt": "S {{q}}", "user_prompt": "Q {{q}}",
              "change_summary": "s", "change_reason": "r", **MODEL},
    ).json()
    pid = created["prompt_id"]
    assert created["is_active"] == "N"

    resp = client.put(
        f"/api/v1/prompts/{pid}",
        json={"system_prompt": "SYS {{x}}", "user_prompt": "NEW {{y}}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["system_prompt"] == "SYS {{x}}"
    assert body["user_prompt"] == "NEW {{y}}"


def test_edit_active_version_locked(client):
    # seeded prompt_id 1 is active
    resp = client.put("/api/v1/prompts/1", json={"system_prompt": "should fail"})
    assert resp.status_code == 400


def test_delete_flow_version(client):
    # cut a 2nd flow version (now active); 1.0.0 becomes inactive
    client.put("/api/v1/flow/main-model", json={"main_model_nm": "gemini-2.5-flash"})
    versions = client.get("/api/v1/flow/versions").json()
    active = next(v for v in versions if v["is_active"] == "Y")
    inactive = next(v for v in versions if v["is_active"] == "N")

    # active version cannot be deleted
    assert client.delete(f"/api/v1/flow/versions/{active['flow_ver_id']}").status_code == 400
    # inactive version deletes
    assert client.delete(f"/api/v1/flow/versions/{inactive['flow_ver_id']}").status_code == 204
    after = client.get("/api/v1/flow/versions").json()
    assert all(v["flow_ver_id"] != inactive["flow_ver_id"] for v in after)


def test_list_and_delete_test_runs(client, stub_llm):
    run = client.post(
        "/api/v1/nodes/2/test/run", json={"prompt_id": 1, "variables": {"q": "hi"}}
    ).json()
    run_id = run["run_id"]

    runs = client.get("/api/v1/test-runs").json()
    assert any(r["run_id"] == run_id for r in runs)

    assert client.delete(f"/api/v1/test-runs/{run_id}").status_code == 204
    assert client.get(f"/api/v1/test-runs/{run_id}").status_code == 404
