from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone

from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core import db as db_module
from app.core.constants import SYSTEM_USER
from app.core.ws import manager
from app.models.dataset import TestCase, TestDataset
from app.models.node_prompt_ver import NodePromptVer
from app.models.ragas import RagasResult, RagasRun
from app.schemas.flow import FlowCurrentOut, FlowNodeOut
from app.schemas.ragas import RagasResultOut
from app.services import external_agent


def _result_payload(row: RagasResult) -> dict:
    """JSON-safe result row for WS streaming — same shape as the HTTP detail
    endpoint (Decimal scores -> floats), so the UI can upsert it directly."""
    return jsonable_encoder(RagasResultOut.model_validate(row))


# Run ids the user asked to cancel. The background run loop (same process, via
# FastAPI BackgroundTasks) checks this between cases and stops cleanly, keeping
# whatever partial answers/scores were already produced.
_cancelled: set[int] = set()


def request_cancel(ragas_run_id: int) -> None:
    """Flag a running RAGAS run for cancellation; the loop stops at the next case."""
    _cancelled.add(ragas_run_id)


def _cancel_requested(session: Session, ragas_run_id: int) -> bool:
    """True if the user asked to cancel this run. Checks the in-process flag (fast
    path, same worker) AND the DB status — the cancel request may be handled by a
    different worker than the one running the loop, so the in-memory set alone is
    not enough; the shared ``CANCELLING`` status is the cross-worker signal."""
    if ragas_run_id in _cancelled:
        return True
    status = session.execute(
        select(RagasRun.status).where(RagasRun.ragas_run_id == ragas_run_id)
    ).scalar()
    return status == "CANCELLING"


_CANCELLED = object()  # sentinel returned by _await_or_cancel when a run is cancelled


def _run_score(scorer, question, answer, contexts, ground_truth):
    """Run one ``scorer.score()`` to completion in a worker thread (its own event
    loop). The real RAGAS engine makes blocking LLM calls; running it off the main
    event loop keeps the server responsive so cancel requests are handled promptly
    instead of being stuck behind the blocking scoring."""
    return asyncio.run(
        scorer.score(question=question, answer=answer, contexts=contexts, ground_truth=ground_truth)
    )


async def _await_or_cancel(coro, session: Session, ragas_run_id: int, *, poll: float = 1.0):
    """Await ``coro`` (an in-flight answer call) but abort it the moment a cancel
    is requested, instead of waiting for it to finish. Polls the cancel signal
    every ``poll`` seconds while the call is in flight; on cancel it cancels the
    task and returns the ``_CANCELLED`` sentinel. Otherwise returns the result
    (re-raising any error from ``coro`` for the caller to record)."""
    task = asyncio.ensure_future(coro)
    while True:
        done, _ = await asyncio.wait({task}, timeout=poll)
        if task in done:
            return task.result()
        if _cancel_requested(session, ragas_run_id):
            task.cancel()
            try:
                await task
            except BaseException:  # noqa: BLE001 - swallow cancellation / abort error
                pass
            return _CANCELLED


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


def _latest_prompt_by_node_nm(db: Session) -> dict[str, NodePromptVer]:
    """Most recent version per node (no persistent active version anymore)."""
    rows = (
        db.execute(
            select(NodePromptVer).order_by(
                NodePromptVer.created_dt.desc(), NodePromptVer.prompt_id.desc()
            )
        )
        .scalars()
        .all()
    )
    latest: dict[str, NodePromptVer] = {}
    for p in rows:
        if p.node_nm not in latest:  # rows are newest-first → first seen is latest
            latest[p.node_nm] = p
    return latest


def get_current_flow(db: Session) -> FlowCurrentOut:
    """The current flow's nodes — drives the node list → per-node prompt management.

    Source of truth is PM_NODE_PROMPT_VER: any NODE_NM that has at least one
    version is a node. The latest version + model are surfaced per node (there is
    no persistent active version — IS_ACTIVE is only set during a test run).
    """
    node_nms = _list_node_nms(db)
    latest = _latest_prompt_by_node_nm(db)
    nodes_out: list[FlowNodeOut] = []
    for nm in node_nms:
        lp = latest.get(nm)
        nodes_out.append(
            FlowNodeOut(
                node_nm=nm,
                latest_prompt_id=lp.prompt_id if lp else None,
                latest_version_no=lp.version_no if lp else None,
                latest_model_nm=lp.model_nm if lp else None,
            )
        )
    return FlowCurrentOut(nodes=nodes_out)


# ---- direct external-API calls (no scoring; recorded as ENGINE='direct' runs) -

# A direct run is recorded as a RagasRun with ENGINE='direct' (no scoring). That
# string is the only thing that tells it apart from a scored RAGAS run, so no new
# column is needed on PM_RAGAS_RUN.
DIRECT_ENGINE = "direct"

# Manual (typed) direct calls have no dataset, but PM_RAGAS_RUN.DATASET_ID is NOT
# NULL. Rather than alter the table, they are attached to this single hidden
# dataset (IS_ACTIVE='N' so it never shows in the dataset list — see
# dataset_service.list_flow_datasets).
_DIRECT_SINK_NM = "(직접 호출)"


def _direct_sink_dataset_id(db: Session) -> int:
    """Get-or-create the hidden dataset that anchors manual direct-call runs so
    their NOT NULL DATASET_ID is satisfied without a schema change."""
    sink = (
        db.execute(
            select(TestDataset).where(
                TestDataset.dataset_nm == _DIRECT_SINK_NM, TestDataset.is_active == "N"
            )
        )
        .scalars()
        .first()
    )
    if sink is None:
        sink = TestDataset(
            dataset_nm=_DIRECT_SINK_NM,
            description="직접 호출 기록 전용 (자동 생성, 목록 비표시)",
            is_active="N",
            created_by=SYSTEM_USER,
        )
        db.add(sink)
        db.flush()
    return sink.dataset_id


async def record_direct_run(
    db: Session,
    *,
    message: str,
    base_url: str | None = None,
    auth_key: str | None = None,
    user_id: str | None = None,
) -> dict:
    """One-shot direct external call, recorded so it shows up in the records page.

    Sends ``message`` straight to the endpoint and returns its answer as-is
    ({response, docs, raw}). On success a direct ``RagasRun`` (ENGINE='direct', no
    scoring) plus a single answer row are persisted; a failing call raises before
    anything is recorded (keeping the records list free of config-error noise)."""
    data = await external_agent.run_direct(
        message=message, base_url=base_url, auth_key=auth_key, user_id=user_id,
    )
    now = datetime.now(timezone.utc)
    run = RagasRun(
        dataset_id=_direct_sink_dataset_id(db), status="DONE", engine=DIRECT_ENGINE,
        created_by=SYSTEM_USER, started_dt=now, ended_dt=now,
    )
    db.add(run)
    db.flush()
    db.add(
        RagasResult(
            ragas_run_id=run.ragas_run_id, case_id=None, question=message,
            answer=data["response"], contexts=json.dumps(data["docs"], ensure_ascii=False),
        )
    )
    db.commit()
    return data


async def run_direct_dataset(
    db: Session,
    *,
    dataset_id: int,
    base_url: str | None = None,
    auth_key: str | None = None,
    user_id: str | None = None,
) -> list[dict]:
    """Run every case of a dataset through a direct external-API call and return
    the answers. No RAGAS scoring, but the run + per-case answers are persisted as
    an ENGINE='direct' ``RagasRun`` so the whole smoke-test shows up in records."""
    from app.services import ragas_service

    _require_flow_dataset(db, dataset_id)
    # Fail fast on a missing endpoint so we return one clear 502 instead of the
    # same "no URL" error repeated on every case (and record nothing).
    external_agent.ensure_direct_url(base_url)
    cases = (
        db.execute(
            select(TestCase).where(TestCase.dataset_id == dataset_id).order_by(TestCase.case_id.asc())
        )
        .scalars()
        .all()
    )
    run = RagasRun(
        dataset_id=dataset_id, status="RUNNING", engine=DIRECT_ENGINE,
        created_by=SYSTEM_USER, started_dt=datetime.now(timezone.utc),
    )
    db.add(run)
    db.flush()
    results: list[dict] = []
    for case in cases:
        fields = ragas_service._parse_case(case.input_data, case.expected_output)
        question = fields["question"] or _message_from_inputs(_case_variables(case.input_data))
        row: dict = {"case_id": case.case_id, "question": question, "answer": None, "docs": [], "error": None}
        result = RagasResult(ragas_run_id=run.ragas_run_id, case_id=case.case_id, question=question)
        try:
            data = await external_agent.run_direct(
                message=question, base_url=base_url, auth_key=auth_key, user_id=user_id,
            )
            row["answer"] = data["response"]
            row["docs"] = data["docs"]
            result.answer = data["response"]
            result.contexts = json.dumps(data["docs"], ensure_ascii=False)
        except Exception as exc:  # noqa: BLE001 - per-case failure, keep going
            row["error"] = str(exc)[:1000]
            result.error_msg = str(exc)[:1000]
        db.add(result)
        results.append(row)
    run.status = "DONE"
    run.ended_dt = datetime.now(timezone.utc)
    db.commit()
    return results


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


def _swap_active_prompt(db: Session, *, node_nm: str, target_prompt_id: int) -> None:
    """Flip IS_ACTIVE on PM_NODE_PROMPT_VER for one NODE_NM so the external model
    reads ``target_prompt_id`` as its active row during this test run only."""
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


def _deactivate_node(db: Session, *, node_nm: str) -> None:
    """Turn off IS_ACTIVE for every version of a node after a test run. There is
    no persistent active version — it is only set transiently while a run uses it."""
    db.execute(
        update(NodePromptVer)
        .where(NodePromptVer.node_nm == node_nm)
        .values(is_active="N")
    )
    db.commit()


def _require_flow_dataset(db: Session, dataset_id: int) -> TestDataset:
    ds = db.get(TestDataset, dataset_id)
    if ds is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="dataset not found")
    return ds


def create_flow_ragas_run(
    db: Session,
    *,
    dataset_id: int,
    metrics: list[str],
    actor: str,
    node_nm: str | None = None,
    prompt_id: int | None = None,
) -> RagasRun:
    """Single flow RAGAS run. When ``prompt_id`` is given the run targets that
    node version (it is activated only while the run uses it); otherwise the flow
    runs against whatever prompts the agent already has."""
    from app.services.ragas import ALL_METRICS

    _require_flow_dataset(db, dataset_id)
    if prompt_id is not None:
        pv = db.get(NodePromptVer, prompt_id)
        if pv is None or (node_nm is not None and pv.node_nm != node_nm):
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                detail=f"prompt version {prompt_id} not found for node {node_nm!r}",
            )
    chosen = [m for m in ALL_METRICS if m in set(metrics)] or list(ALL_METRICS)
    run = RagasRun(
        dataset_id=dataset_id,
        prompt_id=prompt_id,
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


# ---- shared run phases (used by both single and A/B execution) ----------------

def _maybe_swap(session: Session, run: RagasRun) -> str | None:
    """If this run targets a specific version, flip IS_ACTIVE to it so the test
    runs with that version (the external model reads the active row). Applied in
    any mode — IS_ACTIVE is set only while a run uses it. Returns the node_nm to
    deactivate afterward, or None when the run targets no specific version."""
    if run.prompt_id:
        pv = session.get(NodePromptVer, run.prompt_id)
        if pv is not None:
            _swap_active_prompt(session, node_nm=pv.node_nm, target_prompt_id=run.prompt_id)
            return pv.node_nm
    return None


async def _setup_run(session: Session, ragas_run_id: int, dataset_id: int, key: str):
    """Mark RUNNING, load cases, build the scorer, emit RUNNING. Returns
    (run, cases, scorer) or None when the run is missing / scorer build failed
    (failure already recorded)."""
    from app.services import ragas_service
    from app.services.ragas import ALL_METRICS, get_scorer

    run = session.get(RagasRun, ragas_run_id)
    if run is None:
        return None
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
        return None
    return run, cases, scorer


async def _phase1_answers(session: Session, ragas_run_id: int, cases, key: str):
    """Phase 1 — generate + persist each case's answer (streaming ANSWER events).
    Returns (pending, cancelled) where pending is [(row, contexts, fields), ...]."""
    from app.services import ragas_service

    pending: list[tuple[RagasResult, list[str], dict]] = []
    cancelled = False
    for idx, case in enumerate(cases, start=1):
        if _cancel_requested(session, ragas_run_id):
            cancelled = True
            break
        fields = ragas_service._parse_case(case.input_data, case.expected_output)
        row = RagasResult(
            ragas_run_id=ragas_run_id, case_id=case.case_id, question=fields["question"],
            contexts=json.dumps(fields["contexts"], ensure_ascii=False), ground_truth=fields["ground_truth"],
        )
        contexts = fields["contexts"]
        try:
            data = await _await_or_cancel(
                external_agent.flow_answer(
                    message=fields["question"] or _message_from_inputs(_case_variables(case.input_data)),
                ),
                session, ragas_run_id,
            )
            if data is _CANCELLED:  # cancelled mid-call → drop this case, stop
                cancelled = True
                break
            row.answer = str(data.get("response", ""))
            contexts = fields["contexts"] or list(data.get("docs") or [])
        except Exception as exc:  # noqa: BLE001 - answer generation failure
            row.error_msg = str(exc)[:1000]
        session.add(row)
        session.commit()
        pending.append((row, contexts, fields))
        await manager.broadcast(key, {"event": "ANSWER", "run_id": ragas_run_id,
            "done": idx, "total": len(cases), "case_id": case.case_id, "result": _result_payload(row)})
    return pending, cancelled


async def _phase2_scores(session: Session, ragas_run_id: int, pending, scorer, key: str, total: int):
    """Phase 2 — score each answered case (streaming SCORE events). Returns
    (sums, cancelled)."""
    from app.services import ragas_service
    from app.services.ragas import ALL_METRICS

    sums: dict[str, list[float]] = {m: [] for m in ALL_METRICS}
    cancelled = False
    for idx, (row, contexts, fields) in enumerate(pending, start=1):
        if _cancel_requested(session, ragas_run_id):
            cancelled = True
            break
        if row.answer is not None and not row.error_msg:
            try:
                cs = await _await_or_cancel(
                    asyncio.to_thread(
                        _run_score, scorer, fields["question"], row.answer,
                        contexts, fields["ground_truth"],
                    ),
                    session, ragas_run_id,
                )
                if cs is _CANCELLED:  # cancelled mid-scoring → stop now
                    cancelled = True
                    break
                stored = False
                for m, v in cs.as_dict().items():
                    dec = ragas_service._to_score(v)
                    if dec is not None:
                        setattr(row, m, dec)
                        sums[m].append(float(dec))
                        stored = True
                if not stored:
                    row.error_msg = "scorer returned no finite metric scores"
            except Exception as exc:  # noqa: BLE001 - per-case scoring failure
                row.error_msg = str(exc)[:1000]
            session.commit()
        await manager.broadcast(key, {"event": "SCORE", "run_id": ragas_run_id,
            "done": idx, "total": total, "case_id": row.case_id, "result": _result_payload(row)})
    return sums, cancelled


async def _finalize_run(session: Session, run: RagasRun, ragas_run_id: int, key: str, sums, cancelled: bool):
    """Mark the run DONE (with averages) or CANCELLED (partial scores dropped),
    and emit the terminal WS event."""
    from app.services import ragas_service
    from app.services.ragas import ALL_METRICS

    if cancelled:
        # A cancelled run keeps only the answers — drop any partial scoring
        # (per-case metric columns + run averages) so nothing half-computed is
        # stored. The UI shows answers only for a cancelled run.
        session.execute(
            update(RagasResult)
            .where(RagasResult.ragas_run_id == ragas_run_id)
            .values({m: None for m in ALL_METRICS})
        )
        for m in ALL_METRICS:
            setattr(run, m, None)
        run.status = "CANCELLED"
        run.ended_dt = datetime.now(timezone.utc)
        session.commit()
        await manager.broadcast(key, {"event": "CANCELLED", "run_id": ragas_run_id})
        return
    for m in ALL_METRICS:
        setattr(run, m, ragas_service._avg(sums[m]))
    run.status = "DONE"
    run.ended_dt = datetime.now(timezone.utc)
    session.commit()
    summary = {m: float(getattr(run, m)) if getattr(run, m) is not None else None for m in ALL_METRICS}
    await manager.broadcast(
        key,
        {"event": "DONE", "run_id": ragas_run_id, "engine": run.engine, "summary": summary},
    )


async def execute_flow_ragas_run(*, ragas_run_id: int, dataset_id: int) -> None:
    """Score every dataset case by running the whole flow for the answer.

    The answer comes from the external chat endpoint when RUN_MODE=external, else a
    deterministic stub (so RAGAS runs end-to-end before the agent is connected).
    Scoring uses the real ragas engine when a judge LLM is configured, else the
    dependency-free fallback (RAGAS_ENGINE).
    """
    from app.services import ragas_service

    session = db_module.SessionLocal()
    run = None
    key = ragas_service.ws_key(ragas_run_id)
    try:
        setup = await _setup_run(session, ragas_run_id, dataset_id, key)
        if setup is None:
            return
        run, cases, scorer = setup

        swap_node_nm = _maybe_swap(session, run)
        sums: dict[str, list[float]] = {}
        try:
            pending, cancelled = await _phase1_answers(session, ragas_run_id, cases, key)
            if not cancelled:
                sums, cancelled = await _phase2_scores(
                    session, ragas_run_id, pending, scorer, key, len(cases)
                )
        finally:
            if swap_node_nm is not None:
                _deactivate_node(session, node_nm=swap_node_nm)

        await _finalize_run(session, run, ragas_run_id, key, sums, cancelled)
    except Exception as exc:  # noqa: BLE001 - never leave a run stuck/unrecorded
        if run is not None:
            try:
                await ragas_service._record_ragas_failure(session, run, key, str(exc))
            except Exception:  # noqa: BLE001
                pass
    finally:
        _cancelled.discard(ragas_run_id)
        session.close()


async def execute_flow_ragas_ab_run(
    *, ragas_run_a_id: int, ragas_run_b_id: int, dataset_id: int
) -> None:
    """A/B comparison run with phases interleaved across the two versions:
    A answers → B answers → A scores → B scores. So both versions' answers show
    up in the UI before any (slow) scoring starts. Each version's answers are
    generated under its own IS_ACTIVE swap; scoring needs no swap."""
    from app.services import ragas_service

    ids = (ragas_run_a_id, ragas_run_b_id)
    sessions = {rid: db_module.SessionLocal() for rid in ids}
    ctx: dict[int, dict | None] = {}
    try:
        # Setup both runs (RUNNING + scorer).
        for rid in ids:
            session = sessions[rid]
            key = ragas_service.ws_key(rid)
            setup = await _setup_run(session, rid, dataset_id, key)
            ctx[rid] = None if setup is None else {
                "session": session, "run": setup[0], "cases": setup[1], "scorer": setup[2],
                "key": key, "pending": [], "sums": {}, "cancelled": False,
            }

        # Phase 1 — answers for A, then B; each under its own active-prompt swap.
        for rid in ids:
            c = ctx.get(rid)
            if c is None:
                continue
            swap_node_nm = _maybe_swap(c["session"], c["run"])
            try:
                c["pending"], c["cancelled"] = await _phase1_answers(
                    c["session"], rid, c["cases"], c["key"]
                )
            finally:
                if swap_node_nm is not None:
                    _deactivate_node(c["session"], node_nm=swap_node_nm)

        # Phase 2 — scores for A, then B.
        for rid in ids:
            c = ctx.get(rid)
            if c is None or c["cancelled"]:
                continue
            c["sums"], c["cancelled"] = await _phase2_scores(
                c["session"], rid, c["pending"], c["scorer"], c["key"], len(c["cases"])
            )

        # Finalize both.
        for rid in ids:
            c = ctx.get(rid)
            if c is None:
                continue
            await _finalize_run(c["session"], c["run"], rid, c["key"], c["sums"], c["cancelled"])
    except Exception as exc:  # noqa: BLE001 - never leave a run stuck/unrecorded
        for rid in ids:
            c = ctx.get(rid)
            if c is not None:
                try:
                    await ragas_service._record_ragas_failure(c["session"], c["run"], c["key"], str(exc))
                except Exception:  # noqa: BLE001
                    pass
    finally:
        for rid in ids:
            _cancelled.discard(rid)
        for s in sessions.values():
            s.close()
