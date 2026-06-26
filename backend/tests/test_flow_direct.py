"""Direct external-API call endpoint (POST /api/v1/flow/test/direct).

This path is DB-free: it relays the message straight to the external chat
endpoint and returns the answer as-is. The httpx call is faked so the test never
hits the network.
"""
from __future__ import annotations

import app.services.external_agent as ext


class _FakeResp:
    def __init__(self, data):
        self._data = data

    def raise_for_status(self):
        pass

    def json(self):
        return self._data


class _FakeClient:
    """Records the last POST and returns a canned chat response."""

    last: dict = {}

    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, json=None, headers=None):
        _FakeClient.last = {"url": url, "json": json, "headers": headers}
        return _FakeResp({"response": "hi there", "docs": ["d1", {"content": "d2"}], "extra": 1})


def test_direct_no_url_returns_502(client):
    # No base_url override and EXTERNAL_AGENT_BASE_URL unset → clear 502.
    res = client.post("/api/v1/flow/test/direct", json={"message": "hello"})
    assert res.status_code == 502, res.text


def test_direct_success_relays_message_and_answer(client, monkeypatch):
    monkeypatch.setattr(ext.httpx, "AsyncClient", _FakeClient)
    res = client.post(
        "/api/v1/flow/test/direct",
        json={"message": "hello", "base_url": "http://agent.local/chat", "auth_key": "k", "user_id": "u"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["response"] == "hi there"
    # docs are normalized (dict {"content": ...} → its string)
    assert body["docs"] == ["d1", "d2"]
    # the full body is echoed back as-is under "raw"
    assert body["raw"]["extra"] == 1

    # The request carried the overridden URL / payload / headers.
    assert _FakeClient.last["url"] == "http://agent.local/chat"
    sent = _FakeClient.last["json"]
    assert sent["message"] == "hello"
    assert sent["user_id"] == "u"
    # The new chat-request fields are present with their contract defaults.
    assert sent["session_id"] == ""
    assert sent["chat_type"] == ""
    assert sent["a2a_remote_urls"] is None
    assert sent["is_super_agent"] is None
    assert sent["main_model_name"] is None
    assert sent["session_system_prompt"] == "{}"
    assert _FakeClient.last["headers"]["auth-key"] == "k"
    assert _FakeClient.last["headers"]["user-id"] == "u"


# ---- dataset mode -----------------------------------------------------------


def _make_dataset_with_cases(client, questions):
    ds = client.post("/api/v1/flow/datasets", json={"dataset_nm": "direct-ds"}).json()
    for q in questions:
        body = {"input_data": __import__("json").dumps({"question": q}), "expected_output": None}
        assert client.post(f"/api/v1/datasets/{ds['dataset_id']}/cases", json=body).status_code in (200, 201)
    return ds["dataset_id"]


def test_direct_dataset_runs_every_case(client, monkeypatch):
    monkeypatch.setattr(ext.httpx, "AsyncClient", _FakeClient)
    dataset_id = _make_dataset_with_cases(client, ["q1", "q2"])
    res = client.post(
        "/api/v1/flow/test/direct/dataset",
        json={"dataset_id": dataset_id, "base_url": "http://agent.local/chat"},
    )
    assert res.status_code == 200, res.text
    results = res.json()["results"]
    assert len(results) == 2
    assert {r["question"] for r in results} == {"q1", "q2"}
    assert all(r["answer"] == "hi there" and r["error"] is None for r in results)
    assert all(r["docs"] == ["d1", "d2"] for r in results)


def test_direct_dataset_no_url_returns_502(client):
    dataset_id = _make_dataset_with_cases(client, ["q1"])
    res = client.post("/api/v1/flow/test/direct/dataset", json={"dataset_id": dataset_id})
    assert res.status_code == 502, res.text


def test_direct_dataset_missing_dataset_404(client):
    res = client.post(
        "/api/v1/flow/test/direct/dataset",
        json={"dataset_id": 999999, "base_url": "http://agent.local/chat"},
    )
    assert res.status_code == 404, res.text
