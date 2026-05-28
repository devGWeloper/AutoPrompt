from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import db as db_module
from app.core.ws import manager
from app.models.chat_ver import ChatVerMas
from app.models.dataset import TestCase, TestDataset
from app.models.node_mas import NodeMas
from app.models.node_prompt_ver import NodePromptVer
from app.models.ragas import RagasResult, RagasRun
from app.schemas.flow import FlowCurrentOut, FlowNodeOut
from app.services import external_agent


def get_current_chat(db: Session) -> ChatVerMas:
    """The current flow row (latest CHAT_VER_MAS by ID)."""
    chat = (
        db.execute(select(ChatVerMas).order_by(ChatVerMas.id.desc()).limit(1))
        .scalars()
        .first()
    )
    if chat is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="no flow (CHAT_VER_MAS) found")
    return chat


def _active_prompts_by_node(db: Session, node_ids: list[int]) -> dict[int, NodePromptVer]:
    if not node_ids:
        return {}
    rows = (
        db.execute(
            select(NodePromptVer).where(
                NodePromptVer.node_mas_id.in_(node_ids), NodePromptVer.is_active == "Y"
            )
        )
        .scalars()
        .all()
    )
    return {p.node_mas_id: p for p in rows}


def get_current_flow(db: Session) -> FlowCurrentOut:
    """The current flow's nodes (drives the node list → per-node prompt management)."""
    chat = get_current_chat(db)
    nodes = (
        db.execute(
            select(NodeMas).where(NodeMas.chat_ver_id == chat.id).order_by(NodeMas.id.asc())
        )
        .scalars()
        .all()
    )
    actives = _active_prompts_by_node(db, [n.id for n in nodes])

    nodes_out: list[FlowNodeOut] = []
    for n in nodes:
        ap = actives.get(n.id)
        nodes_out.append(
            FlowNodeOut(
                node_mas_id=n.id,
                node_nm=n.node_nm,
                node_desc=n.node_desc,
                has_prompt=(n.prompt_edit_enable_yn or "N").upper() == "Y",
                active_prompt_id=ap.prompt_id if ap else None,
                active_version_no=ap.version_no if ap else None,
            )
        )
    return FlowCurrentOut(chat_ver_id=chat.id, nodes=nodes_out)


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


def _flow_session_system_prompt(db: Session) -> str:
    """session_system_prompt for the current flow = active SYSTEM_PROMPTs joined."""
    chat = get_current_chat(db)
    nodes = db.execute(select(NodeMas).where(NodeMas.chat_ver_id == chat.id)).scalars().all()
    actives = _active_prompts_by_node(db, [n.id for n in nodes])
    parts = [p.system_prompt for p in actives.values() if p.system_prompt]
    return "\n\n".join(parts)


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
        chat_ver_id=get_current_chat(db).id,
        dataset_id=dataset_id,
        status="PENDING",
        metrics=json.dumps(chosen),
        created_by=actor,
    )
    db.add(run)
    db.flush()
    return run


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

        session_sys = _flow_session_system_prompt(session)
        main_model = get_current_chat(session).main_model_nm
        sums: dict[str, list[float]] = {m: [] for m in ALL_METRICS}
        for idx, case in enumerate(cases, start=1):
            fields = ragas_service._parse_case(case.input_data, case.expected_output)
            row = RagasResult(
                ragas_run_id=ragas_run_id, case_id=case.case_id, question=fields["question"],
                contexts=json.dumps(fields["contexts"], ensure_ascii=False), ground_truth=fields["ground_truth"],
            )
            try:
                data = await external_agent.flow_answer(
                    message=fields["question"] or _message_from_inputs(_case_variables(case.input_data)),
                    session_system_prompt=session_sys,
                    main_model_name=main_model,
                )
                row.answer = str(data.get("output", ""))
                contexts = fields["contexts"]
                if not contexts and external_agent.external_enabled():
                    try:
                        contexts = await external_agent.retrieve(fields["question"])
                    except Exception:  # noqa: BLE001 - retrieval optional
                        contexts = []
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
