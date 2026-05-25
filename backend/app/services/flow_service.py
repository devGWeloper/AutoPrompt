from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import db as db_module
from app.core.ws import manager
from app.models.chat_ver import ChatVerMas
from app.models.dataset import TestCase, TestDataset
from app.models.flow_ver import FlowVer, FlowVerNode
from app.models.model_mas import ModelMas
from app.models.node_mas import NodeMas
from app.models.node_prompt_ver import NodePromptVer
from app.models.ragas import RagasResult, RagasRun
from app.models.test_run import TestResult, TestRun
from app.schemas.flow import (
    FlowCurrentOut,
    FlowNodeOut,
    FlowVersionDetail,
    FlowVersionNodeOut,
)
from app.services import audit as audit_service
from app.services import external_agent

_VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def _bump_patch(version_no: str) -> str:
    m = _VERSION_RE.match(version_no or "")
    if not m:
        return "1.0.0"
    major, minor, patch = (int(x) for x in m.groups())
    return f"{major}.{minor}.{patch + 1}"


def get_current_chat(db: Session) -> ChatVerMas:
    """The current flow row.

    >>> FILL IN: production may flag the active flow explicitly. For the demo the
    current flow is the latest CHAT_VER_MAS row (highest ID).
    """
    chat = (
        db.execute(select(ChatVerMas).order_by(ChatVerMas.id.desc()).limit(1))
        .scalars()
        .first()
    )
    if chat is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="no flow (CHAT_VER_MAS) found")
    return chat


def _active_flow_ver(db: Session, chat_ver_id: int) -> FlowVer | None:
    return (
        db.execute(
            select(FlowVer)
            .where(FlowVer.chat_ver_id == chat_ver_id, FlowVer.is_active == "Y")
            .order_by(FlowVer.flow_ver_id.desc())
        )
        .scalars()
        .first()
    )


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
    chat = get_current_chat(db)
    nodes = (
        db.execute(
            select(NodeMas).where(NodeMas.chat_ver_id == chat.id).order_by(NodeMas.id.asc())
        )
        .scalars()
        .all()
    )
    actives = _active_prompts_by_node(db, [n.id for n in nodes])
    active_flow = _active_flow_ver(db, chat.id)

    nodes_out: list[FlowNodeOut] = []
    for n in nodes:
        ap = actives.get(n.id)
        has_prompt = (n.prompt_edit_enable_yn or "N").upper() == "Y"
        nodes_out.append(
            FlowNodeOut(
                node_mas_id=n.id,
                node_nm=n.node_nm,
                node_desc=n.node_desc,
                model_nm=n.model_nm,
                prompt_edit_enable_yn=n.prompt_edit_enable_yn or "N",
                model_edit_enable_yn=n.model_edit_enable_yn or "N",
                main_model_edit_enable_yn=n.main_model_edit_enable_yn or "N",
                has_prompt=has_prompt,
                active_prompt_id=ap.prompt_id if ap else None,
                active_version_no=ap.version_no if ap else None,
            )
        )

    editable = any((n.main_model_edit_enable_yn or "N").upper() == "Y" for n in nodes)
    return FlowCurrentOut(
        chat_ver_id=chat.id,
        flow_version_no=active_flow.flow_version_no if active_flow else None,
        main_model_nm=chat.main_model_nm,
        main_model_editable=editable,
        graph_struct=chat.graph_struct,
        nodes=nodes_out,
    )


def list_models(db: Session) -> list[str]:
    """Available model names from MODEL_MAS.GAIA_MODEL_NM (for the main-model selector)."""
    rows = (
        db.execute(select(ModelMas.gaia_model_nm).order_by(ModelMas.id.asc()))
        .scalars()
        .all()
    )
    # de-dup, preserve order
    seen: dict[str, None] = {}
    for r in rows:
        if r:
            seen.setdefault(r, None)
    return list(seen.keys())


def main_model_editable(db: Session, chat: ChatVerMas) -> bool:
    return bool(
        db.execute(
            select(NodeMas.id).where(
                NodeMas.chat_ver_id == chat.id, NodeMas.main_model_edit_enable_yn == "Y"
            ).limit(1)
        ).first()
    )


def set_main_model(db: Session, *, main_model_nm: str, actor: str) -> FlowVer:
    """Change the flow main model (CHAT_VER_MAS.MAIN_MODEL_NM) and cut a new flow version.

    The model is part of flow version management, so a change bumps the whole-flow
    version (the new PM_FLOW_VER snapshots the new main model).
    """
    chat = get_current_chat(db)
    if not main_model_editable(db, chat):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="main model is not editable (no node has MAIN_MODEL_EDIT_ENABLE_YN='Y')",
        )
    if main_model_nm not in set(list_models(db)):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="model not in MODEL_MAS.GAIA_MODEL_NM"
        )
    chat.main_model_nm = main_model_nm
    chat.update_date = datetime.now(timezone.utc)
    chat.update_user = actor
    db.flush()
    return cut_flow_version(db, actor=actor, summary=f"main model → {main_model_nm}", reason=None)


def cut_flow_version(
    db: Session, *, actor: str, summary: str | None, reason: str | None = None
) -> FlowVer:
    """Snapshot the whole flow as a new version (called on every node activation)."""
    chat = get_current_chat(db)
    current = _active_flow_ver(db, chat.id)
    next_no = _bump_patch(current.flow_version_no) if current else "1.0.0"
    if current:
        current.is_active = "N"

    new_ver = FlowVer(
        chat_ver_id=chat.id,
        flow_version_no=next_no,
        graph_struct=chat.graph_struct,
        main_model_nm=chat.main_model_nm,
        is_active="Y",
        change_summary=summary,
        change_reason=reason,
        created_by=actor,
    )
    db.add(new_ver)
    db.flush()

    nodes = (
        db.execute(select(NodeMas).where(NodeMas.chat_ver_id == chat.id)).scalars().all()
    )
    actives = _active_prompts_by_node(db, [n.id for n in nodes])
    for n in nodes:
        ap = actives.get(n.id)
        db.add(
            FlowVerNode(
                flow_ver_id=new_ver.flow_ver_id,
                node_mas_id=n.id,
                node_nm=n.node_nm,
                prompt_id=ap.prompt_id if ap else None,
                version_no=ap.version_no if ap else None,
            )
        )
    db.flush()

    audit_service.write_audit(
        db,
        target_table="PM_FLOW_VER",
        target_id=new_ver.flow_ver_id,
        action="FLOW_VERSION",
        before={"flow_version_no": current.flow_version_no if current else None},
        after={"flow_version_no": next_no, "summary": summary},
        created_by=actor,
    )
    return new_ver


def list_flow_versions(db: Session) -> list[FlowVer]:
    chat = get_current_chat(db)
    rows = (
        db.execute(
            select(FlowVer)
            .where(FlowVer.chat_ver_id == chat.id)
            .order_by(FlowVer.flow_ver_id.desc())
        )
        .scalars()
        .all()
    )
    return list(rows)


def get_flow_version(db: Session, flow_ver_id: int) -> FlowVersionDetail:
    fv = db.get(FlowVer, flow_ver_id)
    if fv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="flow version not found")
    manifest = (
        db.execute(
            select(FlowVerNode)
            .where(FlowVerNode.flow_ver_id == flow_ver_id)
            .order_by(FlowVerNode.id.asc())
        )
        .scalars()
        .all()
    )
    return FlowVersionDetail(
        flow_ver_id=fv.flow_ver_id,
        chat_ver_id=fv.chat_ver_id,
        flow_version_no=fv.flow_version_no,
        is_active=fv.is_active,
        change_summary=fv.change_summary,
        change_reason=fv.change_reason,
        created_by=fv.created_by,
        created_dt=fv.created_dt,
        graph_struct=fv.graph_struct,
        main_model_nm=fv.main_model_nm,
        nodes=[FlowVersionNodeOut.model_validate(m) for m in manifest],
    )


def delete_flow_version(db: Session, *, flow_ver_id: int, actor: str) -> None:
    """Delete a flow version (+ its manifest). The active version cannot be deleted."""
    fv = db.get(FlowVer, flow_ver_id)
    if fv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="flow version not found")
    if fv.is_active == "Y":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="active flow version cannot be deleted")
    for m in db.execute(
        select(FlowVerNode).where(FlowVerNode.flow_ver_id == flow_ver_id)
    ).scalars():
        db.delete(m)
    db.flush()  # delete children before the parent (FK order; no ORM relationship to auto-order)
    db.delete(fv)
    audit_service.write_audit(
        db, target_table="PM_FLOW_VER", target_id=flow_ver_id, action="DELETE",
        before={"flow_version_no": fv.flow_version_no}, after=None, created_by=actor,
    )


# ---- full / flow test via the internal chat endpoint ---------------------------

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


def _flow_session_system_prompt(db: Session) -> str:
    """The session_system_prompt for the current flow = active SYSTEM_PROMPTs joined.

    >>> FILL IN: a super-agent may want a single node's system prompt rather than all
    prompt nodes concatenated — adjust if the model expects one.
    """
    chat = get_current_chat(db)
    nodes = db.execute(select(NodeMas).where(NodeMas.chat_ver_id == chat.id)).scalars().all()
    actives = _active_prompts_by_node(db, [n.id for n in nodes])
    parts = [p.system_prompt for p in actives.values() if p.system_prompt]
    return "\n\n".join(parts)


def create_flow_test_run(db: Session, *, actor: str) -> TestRun:
    chat = get_current_chat(db)
    run = TestRun(
        run_type="FLOW",
        chat_ver_id=chat.id,
        status="PENDING",
        total_cases=0,
        created_by=actor,
    )
    db.add(run)
    db.flush()
    return run


async def execute_flow_test_run(*, run_id: int, inputs: dict[str, str]) -> None:
    """Drive the whole flow through the operational project's run-flow endpoint."""
    session = db_module.SessionLocal()
    try:
        run = session.get(TestRun, run_id)
        if run is None:
            return
        run.status = "RUNNING"
        run.started_dt = datetime.now(timezone.utc)
        session.commit()
        await manager.broadcast(run_id, {"event": "RUNNING", "run_id": run_id})

        if not external_agent.external_enabled():
            run.status = "FAILED"
            run.ended_dt = datetime.now(timezone.utc)
            session.add(
                TestResult(
                    run_id=run_id,
                    error_msg="full flow test requires RUN_MODE=external + EXTERNAL_AGENT_BASE_URL",
                )
            )
            session.commit()
            await manager.broadcast(
                run_id,
                {"event": "FAILED", "run_id": run_id, "error": "external mode not configured"},
            )
            return

        try:
            data = await external_agent.run_flow(
                message=_message_from_inputs(inputs),
                session_system_prompt=_flow_session_system_prompt(session),
                main_model_name=get_current_chat(session).main_model_nm,
            )
        except Exception as exc:  # noqa: BLE001 - any transport/contract failure
            run.status = "FAILED"
            run.ended_dt = datetime.now(timezone.utc)
            session.add(TestResult(run_id=run_id, error_msg=str(exc)[:1000]))
            session.commit()
            await manager.broadcast(
                run_id, {"event": "FAILED", "run_id": run_id, "error": str(exc)}
            )
            return

        # Single chat turn -> one answer (no per-node trace).
        final_output = str(data.get("output", ""))
        session.add(
            TestResult(
                run_id=run_id,
                actual_output=final_output,
                eval_detail=json.dumps({"final": True}, ensure_ascii=False),
            )
        )
        run.status = "DONE"
        run.total_cases = 1
        run.passed_cases = 1
        run.ended_dt = datetime.now(timezone.utc)
        session.commit()
        await manager.broadcast(
            run_id,
            {"event": "DONE", "run_id": run_id, "output": final_output, "summary": {"nodes": 1}},
        )
    finally:
        session.close()


# ---- flow-level batch / A·B / RAGAS (each dataset case -> whole-flow run) -------

def resolve_version_session(db: Session, flow_ver_id: int) -> tuple[str, str | None]:
    """(session_system_prompt, main_model_name) for a specific flow version.

    The chat model has no per-node ``overrides``; A/B instead runs each side with
    that version's SYSTEM_PROMPTs (joined) + its main model.
    """
    fv = db.get(FlowVer, flow_ver_id)
    parts: list[str] = []
    if fv:
        manifest = (
            db.execute(select(FlowVerNode).where(FlowVerNode.flow_ver_id == flow_ver_id))
            .scalars()
            .all()
        )
        for m in manifest:
            if m.prompt_id:
                pv = db.get(NodePromptVer, m.prompt_id)
                if pv and pv.system_prompt:
                    parts.append(pv.system_prompt)
    return "\n\n".join(parts), (fv.main_model_nm if fv else None)


def _require_flow_dataset(db: Session, dataset_id: int) -> TestDataset:
    ds = db.get(TestDataset, dataset_id)
    if ds is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="dataset not found")
    return ds


def _dataset_total(db: Session, dataset_id: int) -> int:
    return len(
        db.execute(select(TestCase.case_id).where(TestCase.dataset_id == dataset_id)).scalars().all()
    )


def create_flow_batch_run(db: Session, *, dataset_id: int, actor: str) -> TestRun:
    _require_flow_dataset(db, dataset_id)
    run = TestRun(
        run_type="FLOW_BATCH",
        chat_ver_id=get_current_chat(db).id,
        dataset_id=dataset_id,
        status="PENDING",
        total_cases=_dataset_total(db, dataset_id),
        created_by=actor,
    )
    db.add(run)
    db.flush()
    return run


def create_flow_ab_run(
    db: Session, *, dataset_id: int, flow_ver_a: int, flow_ver_b: int, actor: str
) -> tuple[TestRun, TestRun]:
    _require_flow_dataset(db, dataset_id)
    for v in (flow_ver_a, flow_ver_b):
        if db.get(FlowVer, v) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"flow version {v} not found")
    total = _dataset_total(db, dataset_id)
    chat_id = get_current_chat(db).id
    runs = []
    for _ in range(2):
        r = TestRun(
            run_type="FLOW_AB", chat_ver_id=chat_id, dataset_id=dataset_id,
            status="PENDING", total_cases=total, created_by=actor,
        )
        db.add(r)
        db.flush()
        runs.append(r)
    # link the pair: both share the A run's id so the records UI shows one row.
    group_id = runs[0].run_id
    runs[0].ab_group_id = group_id
    runs[1].ab_group_id = group_id
    db.flush()
    return runs[0], runs[1]


async def _run_flow_dataset(
    session: Session,
    *,
    run_id: int,
    dataset_id: int,
    session_system_prompt: str,
    main_model_name: str | None,
):
    from app.services.test_service import _case_variables, _evaluate

    cases = (
        session.execute(
            select(TestCase).where(TestCase.dataset_id == dataset_id).order_by(TestCase.case_id.asc())
        )
        .scalars()
        .all()
    )
    passed = failed = 0
    for idx, case in enumerate(cases, start=1):
        is_passed: str | None = None
        try:
            data = await external_agent.run_flow(
                message=_message_from_inputs(_case_variables(case.input_data)),
                session_system_prompt=session_system_prompt,
                main_model_name=main_model_name,
            )
            output = str(data.get("output", ""))
            is_passed, detail = _evaluate(case.expected_output, output)
            session.add(
                TestResult(
                    run_id=run_id, case_id=case.case_id, actual_output=output,
                    is_passed=is_passed, eval_detail=detail,
                )
            )
            if is_passed == "Y":
                passed += 1
            elif is_passed == "N":
                failed += 1
        except Exception as exc:  # noqa: BLE001 - per-case failure, keep going
            is_passed = "N"
            failed += 1
            session.add(TestResult(run_id=run_id, case_id=case.case_id, is_passed="N", error_msg=str(exc)[:1000]))
        session.commit()
        await manager.broadcast(
            run_id,
            {"event": "PROGRESS", "run_id": run_id, "done": idx, "total": len(cases),
             "case_id": case.case_id, "is_passed": is_passed},
        )
    return passed, failed, None, 0, len(cases)


async def execute_flow_dataset_run(*, run_id: int, dataset_id: int, flow_ver_id: int | None = None) -> None:
    """Run every dataset case through the whole flow (optionally a specific version)."""
    session = db_module.SessionLocal()
    try:
        run = session.get(TestRun, run_id)
        if run is None:
            return
        run.status = "RUNNING"
        run.started_dt = datetime.now(timezone.utc)
        session.commit()
        await manager.broadcast(run_id, {"event": "RUNNING", "run_id": run_id, "total": run.total_cases})

        if not external_agent.external_enabled():
            run.status = "FAILED"
            run.ended_dt = datetime.now(timezone.utc)
            session.add(TestResult(run_id=run_id, error_msg="flow test requires RUN_MODE=external"))
            session.commit()
            await manager.broadcast(run_id, {"event": "FAILED", "run_id": run_id, "error": "external mode not configured"})
            return

        if flow_ver_id:
            session_sys, main_model = resolve_version_session(session, flow_ver_id)
        else:
            session_sys = _flow_session_system_prompt(session)
            main_model = get_current_chat(session).main_model_nm
        passed, failed, avg, tok, total = await _run_flow_dataset(
            session, run_id=run_id, dataset_id=dataset_id,
            session_system_prompt=session_sys, main_model_name=main_model,
        )
        run.status = "DONE"
        run.passed_cases = passed
        run.failed_cases = failed
        run.avg_latency_ms = avg
        run.total_tokens = tok
        run.ended_dt = datetime.now(timezone.utc)
        session.commit()
        await manager.broadcast(
            run_id,
            {"event": "DONE", "run_id": run_id,
             "summary": {"total": total, "passed": passed, "failed": failed, "avg_latency_ms": avg, "total_tokens": tok}},
        )
    finally:
        session.close()


def create_flow_ragas_run(db: Session, *, dataset_id: int, metrics: list[str], actor: str) -> RagasRun:
    from app.services.ragas import ALL_METRICS

    _require_flow_dataset(db, dataset_id)
    chosen = [m for m in ALL_METRICS if m in set(metrics)] or list(ALL_METRICS)
    run = RagasRun(
        node_mas_id=None, prompt_id=None, chat_ver_id=get_current_chat(db).id,
        dataset_id=dataset_id, status="PENDING", metrics=json.dumps(chosen), created_by=actor,
    )
    db.add(run)
    db.flush()
    return run


async def execute_flow_ragas_run(*, ragas_run_id: int, dataset_id: int) -> None:
    """Score every dataset case by running the whole flow for the answer."""
    from app.services import ragas_service
    from app.services.ragas import ALL_METRICS, get_scorer
    from app.services.test_service import _case_variables

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
            if not external_agent.external_enabled():
                raise RuntimeError("flow RAGAS requires RUN_MODE=external")
        except Exception as exc:  # noqa: BLE001 - setup/external failure -> record + stop
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
                data = await external_agent.run_flow(
                    message=fields["question"] or _message_from_inputs(_case_variables(case.input_data)),
                    session_system_prompt=session_sys,
                    main_model_name=main_model,
                )
                row.answer = str(data.get("output", ""))
                contexts = fields["contexts"]
                if not contexts:
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
