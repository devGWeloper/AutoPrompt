from __future__ import annotations

import io


def test_dataset_crud(client):
    created = client.post(
        "/api/v1/nodes/2/datasets",
        json={"dataset_nm": "golden", "description": "demo"},
    )
    assert created.status_code == 201, created.text
    ds = created.json()
    assert ds["case_count"] == 0
    did = ds["dataset_id"]

    listed = client.get("/api/v1/nodes/2/datasets").json()
    assert any(d["dataset_id"] == did for d in listed)

    upd = client.put(f"/api/v1/datasets/{did}", json={"dataset_nm": "golden-v2"})
    assert upd.status_code == 200
    assert upd.json()["dataset_nm"] == "golden-v2"

    assert client.delete(f"/api/v1/datasets/{did}").status_code == 204
    assert client.get(f"/api/v1/datasets/{did}").status_code == 404


def test_case_crud(client):
    did = client.post(
        "/api/v1/nodes/2/datasets",
        json={"dataset_nm": "ds"},
    ).json()["dataset_id"]

    case = client.post(
        f"/api/v1/datasets/{did}/cases",
        json={"case_nm": "c1", "input_data": '{"q": "hi"}', "expected_output": "hello"},
    )
    assert case.status_code == 201, case.text
    cid = case.json()["case_id"]

    cases = client.get(f"/api/v1/datasets/{did}/cases").json()
    assert len(cases) == 1

    upd = client.put(
        f"/api/v1/datasets/{did}/cases/{cid}",
        json={"expected_output": "bye"},
    )
    assert upd.status_code == 200 and upd.json()["expected_output"] == "bye"

    assert client.delete(f"/api/v1/datasets/{did}/cases/{cid}").status_code == 204
    assert client.get(f"/api/v1/datasets/{did}/cases").json() == []


def test_csv_upload_counts_created_and_skipped(client):
    did = client.post(
        "/api/v1/nodes/2/datasets",
        json={"dataset_nm": "csv-ds"},
    ).json()["dataset_id"]

    csv_text = (
        "case_name,input_json,expected_output,eval_criteria,case_type\n"
        'good1,"{""q"":1}",ok,,NORMAL\n'
        'good2,"{""q"":2}",ok,,EDGE\n'
        "bad,,should-skip,,NORMAL\n"
    )
    files = {"file": ("cases.csv", io.BytesIO(csv_text.encode("utf-8")), "text/csv")}
    resp = client.post(f"/api/v1/datasets/{did}/upload", files=files)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["created"] == 2
    assert body["skipped"] == 1
    assert len(body["errors"]) == 1

    cases = client.get(f"/api/v1/datasets/{did}/cases").json()
    assert len(cases) == 2
