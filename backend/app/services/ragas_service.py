from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import db as db_module
from app.core.ws import manager
from app.models.dataset import TestCase, TestDataset
from app.models.node import Node
from app.models.prompt import PromptVersion
from app.models.ragas import RagasResult, RagasRun
from app.schemas.ragas import RagasRunRequest
from app.services import test_service
from app.services.ragas import ALL_METRICS, get_scorer

_METRIC_COLS = ALL_METRICS


def ws_key(ragas_run_id: int) -> str:
    """Namespaced WS channel so RAGAS ids never collide with TestRun ids."""
    return f"ragas:{ragas_run_id}"


def _parse_case(input_data: str, expected_output: str | None) -> dict:
    """Extract RAGAS fields from a test case.

    ``input_data`` is JSON; recognised keys: question, contexts (list|str),
    ground_truth. ``ground_truth`` falls back to the case's expected_output.
    """
    try:
        parsed = json.loads(input_data)
    except (ValueError, TypeError):
        parsed = {}
    if not isinstance(parsed, dict):
        parsed = {}
    contexts = parsed.get("contexts")
    if isinstance(contexts, str):
        contexts = [contexts]
    elif not isinstance(contexts, list):
        contexts = []
    return {
        "question": str(parsed.get("question", "")),
        "contexts": [str(c) for c in contexts],
        "ground_truth": parsed.get("ground_truth") or expected_output,
    }


def create_ragas_run(
    db: Session, *, node_id: int, payload: RagasRunRequest, actor: str
) -> RagasRun:
    if db.get(Node, node_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="node not found")
    prompt = db.get(PromptVersion, payload.prompt_id)
    if prompt is None or prompt.node_id != node_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="prompt version not found")
    dataset = db.get(TestDataset, payload.dataset_id)
    if dataset is None or dataset.node_id != node_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="dataset not found")

    metrics = [m for m in ALL_METRICS if m in set(payload.metrics)] or list(ALL_METRICS)
    run = RagasRun(
        node_id=node_id,
        prompt_id=payload.prompt_id,
        dataset_id=payload.dataset_id,
        status="PENDING",
        metrics=json.dumps(metrics),
        judge_provider=payload.judge_provider,
        judge_model=payload.judge_model,
        created_by=actor,
    )
    db.add(run)
    db.flush()
    return run


def _to_score(v: float | None) -> Decimal | None:
    """Convert a raw metric score to a DB-safe Decimal, or None.

    Oracle NUMBER columns reject NaN/inf (DPY-4004), and ragas yields NaN when a
    metric can't be computed — so non-finite values are stored as NULL.
    """
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(f):
        return None
    return Decimal(str(round(f, 4)))


def _avg(values: list[float]) -> Decimal | None:
    return Decimal(str(round(sum(values) / len(values), 4))) if values else None


async def execute_ragas_run(
    *,
    ragas_run_id: int,
    prompt_id: int,
    dataset_id: int,
) -> None:
    """Score every dataset case for one prompt version; stream progress over WS.

    Uses the prompt version's own model adapter to produce the answer (via the
    shared ``test_service`` helpers, so the ``stub_llm`` test fixture also
    covers this path), then scores with the selected RAGAS engine/fallback.
    """
    session = db_module.SessionLocal()
    try:
        run = session.get(RagasRun, ragas_run_id)
        prompt = session.get(PromptVersion, prompt_id)
        if run is None or prompt is None:
            return
        key = ws_key(ragas_run_id)

        metrics = json.loads(run.metrics) if run.metrics else list(ALL_METRICS)
        scorer = get_scorer(
            metrics,
            judge_provider=run.judge_provider,
            judge_model=run.judge_model,
        )
        run.engine = scorer.engine
        run.status = "RUNNING"
        run.started_dt = datetime.now(timezone.utc)
        session.commit()

        cases = (
            session.execute(
                select(TestCase)
                .where(TestCase.dataset_id == dataset_id)
                .order_by(TestCase.case_id.asc())
            )
            .scalars()
            .all()
        )
        await manager.broadcast(
            key,
            {"event": "RUNNING", "run_id": ragas_run_id, "total": len(cases)},
        )

        try:
            adapter = test_service._adapter_for(prompt)
        except Exception as exc:  # noqa: BLE001 - bad model config
            run.status = "FAILED"
            run.error_msg = str(exc)[:1000]
            run.ended_dt = datetime.now(timezone.utc)
            session.commit()
            await manager.broadcast(
                key,
                {"event": "FAILED", "run_id": ragas_run_id, "error": str(exc)},
            )
            return

        sums: dict[str, list[float]] = {m: [] for m in _METRIC_COLS}
        for idx, case in enumerate(cases, start=1):
            fields = _parse_case(case.input_data, case.expected_output)
            row = RagasResult(
                ragas_run_id=ragas_run_id,
                case_id=case.case_id,
                question=fields["question"],
                contexts=json.dumps(fields["contexts"], ensure_ascii=False),
                ground_truth=fields["ground_truth"],
            )
            try:
                inv = await adapter.invoke(
                    system_prompt=prompt.system_prompt,
                    user_prompt=prompt.user_prompt,
                    variables=test_service._case_variables(case.input_data),
                )
                row.answer = inv.output
                cs = await scorer.score(
                    question=fields["question"],
                    answer=inv.output,
                    contexts=fields["contexts"],
                    ground_truth=fields["ground_truth"],
                )
                stored_any = False
                for m, v in cs.as_dict().items():
                    dec = _to_score(v)
                    if dec is not None:
                        setattr(row, m, dec)
                        sums[m].append(float(dec))
                        stored_any = True
                if not stored_any:
                    # Judge produced no finite scores (all NaN) — surface why the
                    # row is blank instead of leaving it silently empty.
                    row.error_msg = "scorer returned no finite metric scores (all NaN/None)"
            except Exception as exc:  # noqa: BLE001 - per-case failure, keep going
                row.error_msg = str(exc)[:1000]
            session.add(row)
            session.commit()
            await manager.broadcast(
                key,
                {
                    "event": "PROGRESS",
                    "run_id": ragas_run_id,
                    "done": idx,
                    "total": len(cases),
                    "case_id": case.case_id,
                },
            )

        for m in _METRIC_COLS:
            setattr(run, m, _avg(sums[m]))
        run.status = "DONE"
        run.ended_dt = datetime.now(timezone.utc)
        session.commit()
        await manager.broadcast(
            key,
            {
                "event": "DONE",
                "run_id": ragas_run_id,
                "engine": run.engine,
                "summary": {
                    m: float(getattr(run, m)) if getattr(run, m) is not None else None
                    for m in _METRIC_COLS
                },
            },
        )
    finally:
        session.close()
