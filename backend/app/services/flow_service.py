from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core import db as db_module
from app.core.ws import manager
from app.models.dataset import TestCase, TestDataset
from app.models.node_prompt_ver import NodePromptVer
from app.models.ragas import RagasResult, RagasRun
from app.schemas.flow import FlowCurrentOut, FlowNodeOut
from app.services import external_agent


def _list_node_nms(db: Session) -> list[str]:
    """Distinct NODE_NM in PM_NODE_PROMPT_VER, ordered by first appearance."""
    rows = (
        db.execute(
            select(NodePromptVer.node_nm, NodePromptVer.prompt_id).order_by(
                NodePromptVer.prompt_id.asc()
            )
        )
        .all()
    )
    seen: dict[str, None] = {}
    for nm, _ in rows:
        if nm not in seen:
            seen[nm] = None
    return list(seen.keys())


def _active_prompts_by_node_nm(db: Session) -> dict[str, NodePromptVer]:
    rows = (
        db.execute(select(NodePromptVer).where(NodePromptVer.is_active == "Y"))
        .scalars()
        .all()
    )
    return {p.node_nm: p for p in rows}


def get_current_flow(db: Session) -> FlowCurrentOut:
    """The current flow's nodes — drives the node list → per-node prompt management.

    Source of truth is PM_NODE_PROMPT_VER: any NODE_NM that has at least one
    version is a node. Active version + model are surfaced per node.
    """
    node_nms = _list_node_nms(db)
    actives = _active_prompts_by_node_nm(db)
    nodes_out: list[FlowNodeOut] = []
    for nm in node_nms:
        ap = actives.get(nm)
        nodes_out.append(
            FlowNodeOut(
                node_nm=nm,
                active_prompt_id=ap.prompt_id if ap else None,
                active_version_no=ap.version_no if ap else None,
                active_model_nm=ap.model_nm if ap else None,
            )
        )
    return FlowCurrentOut(nodes=nodes_out)


# ---- flow-level RAGAS (each dataset case -> one whole-flow answer -> score) -----

def _message_from_inputs(inputs: dict[str, str]) -> str:
    """Pick the chat ``message`` from a test input dict (tolerant of key name)."""
    for k in ("message", "question", "query", "input", "text"):
        v = inputs.get(k)
        if isinstance(v, str) and v:
            return v
    for v in inputs.values():
        if isinstance(v, str) and v:
            return v
    return json.dumps(inputs, ensure_ascii=False)


def _case_variables(input_data: str) -> dict[str, str]:
    try:
        parsed = json.loads(input_data)
    except (ValueError, TypeError):
        return {}
    if not isinstance(parsed, dict):
        return {}
    return {str(k): str(v) for k, v in parsed.items()}


def _swap_active_prompt(
    db: Session, *, node_nm: str, target_prompt_id: int
) -> int | None:
    """Flip IS_ACTIVE on PM_NODE_PROMPT_VER for one NODE_NM so the external model
    reads ``target_prompt_id`` as its active row. Returns the prompt_id that was
    previously active (to restore later), or None if no row was active.
    """
    prev = (
        db.execute(
            select(NodePromptVer.prompt_id).where(
                NodePromptVer.node_nm == node_nm,
                NodePromptVer.is_active == "Y",
            )
        )
        .scalars()
        .first()
    )
    db.execute(
        update(NodePromptVer)
        .where(NodePromptVer.node_nm == node_nm)
        .values(is_active="N")
    )
    db.execute(
        update(NodePromptVer)
        .where(NodePromptVer.prompt_id == target_prompt_id)
        .values(is_active="Y")
    )
    db.commit()
    return prev


def _restore_active_prompt(
    db: Session, *, node_nm: str, prompt_id: int | None
) -> None:
    """Restore the previously-active row after an A/B evaluation. ``None`` means
    no row was active before — leave them all deactivated."""
    db.execute(
        update(NodePromptVer)
        .where(NodePromptVer.node_nm == node_nm)
        .values(is_active="N")
    )
    if prompt_id is not None:
        db.execute(
            update(NodePromptVer)
            .where(NodePromptVer.prompt_id == prompt_id)
            .values(is_active="Y")
        )
    db.commit()


def _require_flow_dataset(db: Session, dataset_id: int) -> TestDataset:
    ds = db.get(TestDataset, dataset_id)
    if ds is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="dataset not found")
    return ds


def create_flow_ragas_run(db: Session, *, dataset_id: int, metrics: list[str], actor: str) -> RagasRun:
    from app.services.ragas import ALL_METRICS

    _require_flow_dataset(db, dataset_id)
    chosen = [m for m in ALL_METRICS if m in set(metrics)] or list(ALL_METRICS)
    run = RagasRun(
        dataset_id=dataset_id,
        status="PENDING",
        metrics=json.dumps(chosen),
        created_by=actor,
    )
    db.add(run)
    db.flush()
    return run


def create_flow_ragas_ab_run(
    db: Session,
    *,
    dataset_id: int,
    node_nm: str,
    prompt_id_a: int,
    prompt_id_b: int,
    metrics: list[str],
    actor: str,
) -> tuple[RagasRun, RagasRun]:
    """Two RAGAS runs comparing two prompt versions of one node (shared AB_GROUP_ID)."""
    from app.services.ragas import ALL_METRICS

    _require_flow_dataset(db, dataset_id)
    for pid in (prompt_id_a, prompt_id_b):
        pv = db.get(NodePromptVer, pid)
        if pv is None or pv.node_nm != node_nm:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                detail=f"prompt version {pid} not found for node {node_nm!r}",
            )
    chosen = [m for m in ALL_METRICS if m in set(metrics)] or list(ALL_METRICS)
    runs: list[RagasRun] = []
    for pid in (prompt_id_a, prompt_id_b):
        r = RagasRun(
            dataset_id=dataset_id, prompt_id=pid,
            status="PENDING", metrics=json.dumps(chosen), created_by=actor,
        )
        db.add(r)
        db.flush()
        runs.append(r)
    group = runs[0].ragas_run_id
    runs[0].ab_group_id = group
    runs[1].ab_group_id = group
    db.flush()
    return runs[0], runs[1]


async def execute_flow_ragas_run(*, ragas_run_id: int, dataset_id: int) -> None:
    """Score every dataset case by running the whole flow for the answer.

    The answer comes from the external chat endpoint when RUN_MODE=external, else a
    deterministic stub (so RAGAS runs end-to-end before the agent is connected).
    Scoring uses the real ragas engine when a judge LLM is configured, else the
    dependency-free fallback (RAGAS_ENGINE).
    """
    from app.services import ragas_service
    from app.services.ragas import ALL_METRICS, get_scorer

    session = db_module.SessionLocal()
    run = None
    key = ragas_service.ws_key(ragas_run_id)
    try:
        run = session.get(RagasRun, ragas_run_id)
        if run is None:
            return
        run.status = "RUNNING"
        run.started_dt = datetime.now(timezone.utc)
        session.commit()

        cases = (
            session.execute(
                select(TestCase).where(TestCase.dataset_id == dataset_id).order_by(TestCase.case_id.asc())
            )
            .scalars()
            .all()
        )
        await manager.broadcast(key, {"event": "RUNNING", "run_id": ragas_run_id, "total": len(cases)})

        try:
            metrics = json.loads(run.metrics) if run.metrics else list(ALL_METRICS)
            scorer = get_scorer(metrics, judge_provider=run.judge_provider, judge_model=run.judge_model)
            run.engine = scorer.engine
            session.commit()
        except Exception as exc:  # noqa: BLE001 - scorer setup failure -> record + stop
            await ragas_service._record_ragas_failure(session, run, key, str(exc))
            return

        # A/B run: flip PM_NODE_PROMPT_VER active flag so the external model reads
        # this run's version under test. Stub mode skips the toggle (the stub never
        # consults the DB). Always restored in the inner finally below.
        ab_backup: int | None = None
        ab_node_nm: str | None = None
        if run.prompt_id and external_agent.external_enabled():
            pv = session.get(NodePromptVer, run.prompt_id)
            if pv is not None:
                ab_node_nm = pv.node_nm
                ab_backup = _swap_active_prompt(
                    session, node_nm=ab_node_nm, target_prompt_id=run.prompt_id
                )

        sums: dict[str, list[float]] = {m: [] for m in ALL_METRICS}
        try:
            for idx, case in enumerate(cases, start=1):
                fields = ragas_service._parse_case(case.input_data, case.expected_output)
                row = RagasResult(
                    ragas_run_id=ragas_run_id, case_id=case.case_id, question=fields["question"],
                    contexts=json.dumps(fields["contexts"], ensure_ascii=False), ground_truth=fields["ground_truth"],
                )
                try:
                    data = await external_agent.flow_answer(
                        message=fields["question"] or _message_from_inputs(_case_variables(case.input_data)),
                    )
                    row.answer = str(data.get("response", ""))
                    contexts = fields["contexts"] or list(data.get("docs") or [])
                    cs = await scorer.score(
                        question=fields["question"], answer=row.answer,
                        contexts=contexts, ground_truth=fields["ground_truth"],
                    )
                    stored = False
                    for m, v in cs.as_dict().items():
                        dec = ragas_service._to_score(v)
                        if dec is not None:
                            setattr(row, m, dec)
                            sums[m].append(float(dec))
                            stored = True
                    if not stored:
                        row.error_msg = "scorer returned no finite metric scores"
                except Exception as exc:  # noqa: BLE001 - per-case failure
                    row.error_msg = str(exc)[:1000]
                session.add(row)
                session.commit()
                await manager.broadcast(key, {"event": "PROGRESS", "run_id": ragas_run_id, "done": idx, "total": len(cases), "case_id": case.case_id})
        finally:
            if ab_node_nm is not None:
                _restore_active_prompt(session, node_nm=ab_node_nm, prompt_id=ab_backup)

        for m in ALL_METRICS:
            setattr(run, m, ragas_service._avg(sums[m]))
        run.status = "DONE"
        run.ended_dt = datetime.now(timezone.utc)
        session.commit()
        await manager.broadcast(
            key,
            {"event": "DONE", "run_id": ragas_run_id, "engine": run.engine,
             "summary": {m: float(getattr(run, m)) if getattr(run, m) is not None else None for m in ALL_METRICS}},
        )
    except Exception as exc:  # noqa: BLE001 - never leave a run stuck/unrecorded
        if run is not None:
            try:
                await ragas_service._record_ragas_failure(session, run, key, str(exc))
            except Exception:  # noqa: BLE001
                pass
    finally:
        session.close()
