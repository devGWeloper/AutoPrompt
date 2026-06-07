"""Proves cancellation actually stops a running flow-RAGAS evaluation mid-run
(including aborting the in-flight answer call), and that a cancelled run stores
no scores. Drives ``execute_flow_ragas_run`` directly as a coroutine so a cancel
can land while the run is still in flight (TestClient would run the whole
background task before returning)."""
from __future__ import annotations

import asyncio

from sqlalchemy import select

from app.core import db as db_module
from app.models.ragas import RagasResult, RagasRun
from app.services import flow_service


def _make_dataset(client, n: int) -> int:
    did = client.post("/api/v1/flow/datasets", json={"dataset_nm": "cancel-ds"}).json()["dataset_id"]
    for i in range(n):
        client.post(
            f"/api/v1/datasets/{did}/cases",
            json={"input_data": f'{{"question": "q{i}", "contexts": ["c{i}"]}}'},
        )
    return did


def test_cancel_aborts_inflight_and_stores_no_scores(client, monkeypatch):
    # Fallback scorer (no LLM) + a SLOW answer call (longer than the 1s cancel
    # poll) so a cancel lands while one answer call is still in flight.
    monkeypatch.setattr("app.services.ragas.ragas_importable", lambda: False)

    async def slow_answer(*, message):
        await asyncio.sleep(2.0)
        return {"response": f"[stub answer] {message}", "docs": []}

    monkeypatch.setattr("app.services.external_agent.flow_answer", slow_answer)

    n = 6
    did = _make_dataset(client, n)

    s = db_module.SessionLocal()
    run = flow_service.create_flow_ragas_run(s, dataset_id=did, metrics=[], actor="test")
    s.commit()
    rid = run.ragas_run_id
    s.close()

    async def scenario():
        task = asyncio.ensure_future(
            flow_service.execute_flow_ragas_run(ragas_run_id=rid, dataset_id=did)
        )
        await asyncio.sleep(0.5)           # run is now blocked in the 1st (slow) answer call
        flow_service.request_cancel(rid)   # user clicks cancel mid-call
        # If cancel works, the in-flight call is aborted (~1s poll) and the task
        # returns quickly; if it doesn't, this would take ~12s (6 x 2s) and time out.
        await asyncio.wait_for(task, timeout=6)

    asyncio.run(scenario())

    s = db_module.SessionLocal()
    run = s.get(RagasRun, rid)
    results = s.execute(
        select(RagasResult).where(RagasResult.ragas_run_id == rid)
    ).scalars().all()
    s.close()

    assert run.status == "CANCELLED"
    # Stopped mid-run: nowhere near all 6 cases were processed.
    assert len(results) < n
    # A cancelled run keeps no scores.
    assert all(r.faithfulness is None for r in results)
    assert run.faithfulness is None
