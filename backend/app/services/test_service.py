from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import db as db_module
from app.core.config import get_settings
from app.core.ws import manager
from app.models.chat_ver import ChatVerMas
from app.models.dataset import TestCase, TestDataset
from app.models.node_mas import NodeMas
from app.models.node_prompt_ver import NodePromptVer
from app.models.test_run import TestResult, TestRun
from app.schemas.test_run import SingleTestRequest
from app.services.llm import adapter_for_model


def current_main_model(db: Session) -> str | None:
    """The flow main model (CHAT_VER_MAS.MAIN_MODEL_NM) — the single LLM model.

    Per-node MODEL_NM is NULL/unused; the model is decided at the whole-flow level.
    """
    return (
        db.execute(select(ChatVerMas.main_model_nm).order_by(ChatVerMas.id.desc()).limit(1))
        .scalars()
        .first()
    )


def _adapter_for(prompt: NodePromptVer, *, model_nm: str | None = None):
    """Build the LLM adapter for a node prompt version.

    The model is the flow main model (passed in as ``model_nm``), falling back to
    the version's own stored model name. When an internal LLM gateway is configured
    (``LLM_ENDPOINT``) the call routes there with ``LLM_MODEL_NAME``; otherwise the
    provider is inferred from the model name (see ``adapter_for_model``).
    """
    effective = model_nm or prompt.model_nm
    extra = json.loads(prompt.extra_params) if prompt.extra_params else None
    if not effective and not get_settings().internal_llm_enabled():
        raise RuntimeError("no model configured (flow main model is empty)")
    return adapter_for_model(
        effective,
        temperature=float(prompt.temperature) if prompt.temperature is not None else None,
        max_tokens=prompt.max_tokens,
        top_p=float(prompt.top_p) if prompt.top_p is not None else None,
        extra_params=extra,
    )


def _evaluate(expected: str | None, actual: str) -> tuple[str | None, str]:
    """Deterministic pass/fail: case-insensitive exact-or-substring match."""
    if expected is None or expected.strip() == "":
        return None, json.dumps({"method": "none"})
    e = expected.strip().lower()
    a = (actual or "").strip().lower()
    passed = e == a or e in a
    return ("Y" if passed else "N"), json.dumps(
        {"method": "exact_or_substring", "expected": expected}
    )


def create_single_run(
    db: Session, *, node_mas_id: int, payload: SingleTestRequest, actor: str
) -> TestRun:
    if db.get(NodeMas, node_mas_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="node not found")

    prompt = db.get(NodePromptVer, payload.prompt_id)
    if prompt is None or prompt.node_mas_id != node_mas_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="prompt version not found")

    run = TestRun(
        run_type="NODE",
        node_mas_id=node_mas_id,
        prompt_id=prompt.prompt_id,
        dataset_id=None,
        status="PENDING",
        total_cases=1,
        created_by=actor,
    )
    db.add(run)
    db.flush()
    return run


async def execute_single_run(*, run_id: int, prompt_id: int, variables: dict[str, str]) -> None:
    """Run one LLM invocation on its own DB session and stream progress over WS."""
    session = db_module.SessionLocal()
    try:
        run = session.get(TestRun, run_id)
        prompt = session.get(NodePromptVer, prompt_id)
        if run is None or prompt is None:
            return

        run.status = "RUNNING"
        run.started_dt = datetime.now(timezone.utc)
        session.commit()
        await manager.broadcast(run_id, {"event": "RUNNING", "run_id": run_id})

        try:
            adapter = _adapter_for(prompt, model_nm=current_main_model(session))
            result = await adapter.invoke(
                system_prompt=prompt.system_prompt,
                user_prompt=prompt.user_prompt,
                variables=variables,
            )
        except Exception as exc:  # noqa: BLE001 - record any provider/config failure
            session.add(TestResult(run_id=run_id, case_id=None, error_msg=str(exc)[:1000]))
            run.status = "FAILED"
            run.failed_cases = 1
            run.ended_dt = datetime.now(timezone.utc)
            session.commit()
            await manager.broadcast(
                run_id, {"event": "FAILED", "run_id": run_id, "error": str(exc)}
            )
            return

        tr = TestResult(
            run_id=run_id,
            case_id=None,
            actual_output=result.output,
            is_passed=None,
            latency_ms=result.latency_ms,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
        )
        session.add(tr)
        run.status = "DONE"
        run.passed_cases = 0
        run.avg_latency_ms = result.latency_ms
        run.total_tokens = result.input_tokens + result.output_tokens
        run.ended_dt = datetime.now(timezone.utc)
        session.commit()
        session.refresh(tr)

        await manager.broadcast(
            run_id,
            {
                "event": "DONE",
                "run_id": run_id,
                "result": {
                    "actual_output": result.output,
                    "latency_ms": result.latency_ms,
                    "input_tokens": result.input_tokens,
                    "output_tokens": result.output_tokens,
                    "model": result.model,
                },
            },
        )
    finally:
        session.close()


# ---- batch / A-B ----------------------------------------------------------

def create_batch_run(
    db: Session,
    *,
    node_mas_id: int,
    prompt_id: int,
    dataset_id: int,
    run_type: str,
    actor: str,
) -> TestRun:
    if db.get(NodeMas, node_mas_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="node not found")
    prompt = db.get(NodePromptVer, prompt_id)
    if prompt is None or prompt.node_mas_id != node_mas_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="prompt version not found")
    dataset = db.get(TestDataset, dataset_id)
    if dataset is None or dataset.node_mas_id != node_mas_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="dataset not found")

    total = len(
        db.execute(
            select(TestCase.case_id).where(TestCase.dataset_id == dataset_id)
        ).scalars().all()
    )
    run = TestRun(
        run_type=run_type,
        node_mas_id=node_mas_id,
        prompt_id=prompt_id,
        dataset_id=dataset_id,
        status="PENDING",
        total_cases=total,
        created_by=actor,
    )
    db.add(run)
    db.flush()
    return run


def _case_variables(input_data: str) -> dict[str, str]:
    try:
        parsed = json.loads(input_data)
    except (ValueError, TypeError):
        return {}
    if not isinstance(parsed, dict):
        return {}
    return {str(k): str(v) for k, v in parsed.items()}


async def execute_batch_run(*, run_id: int, prompt_id: int, dataset_id: int) -> None:
    """Run every case in a dataset through one prompt version; stream progress."""
    session = db_module.SessionLocal()
    try:
        run = session.get(TestRun, run_id)
        prompt = session.get(NodePromptVer, prompt_id)
        if run is None or prompt is None:
            return

        run.status = "RUNNING"
        run.started_dt = datetime.now(timezone.utc)
        session.commit()
        await manager.broadcast(
            run_id, {"event": "RUNNING", "run_id": run_id, "total": run.total_cases}
        )

        try:
            adapter = _adapter_for(prompt, model_nm=current_main_model(session))
        except Exception as exc:  # noqa: BLE001 - bad model config
            run.status = "FAILED"
            run.ended_dt = datetime.now(timezone.utc)
            session.commit()
            await manager.broadcast(
                run_id, {"event": "FAILED", "run_id": run_id, "error": str(exc)}
            )
            return

        cases = (
            session.execute(
                select(TestCase)
                .where(TestCase.dataset_id == dataset_id)
                .order_by(TestCase.case_id.asc())
            )
            .scalars()
            .all()
        )

        passed = failed = lat_sum = lat_n = tok_sum = 0
        for idx, case in enumerate(cases, start=1):
            try:
                result = await adapter.invoke(
                    system_prompt=prompt.system_prompt,
                    user_prompt=prompt.user_prompt,
                    variables=_case_variables(case.input_data),
                )
                is_passed, detail = _evaluate(case.expected_output, result.output)
                session.add(
                    TestResult(
                        run_id=run_id,
                        case_id=case.case_id,
                        actual_output=result.output,
                        is_passed=is_passed,
                        eval_detail=detail,
                        latency_ms=result.latency_ms,
                        input_tokens=result.input_tokens,
                        output_tokens=result.output_tokens,
                    )
                )
                lat_sum += result.latency_ms
                lat_n += 1
                tok_sum += result.input_tokens + result.output_tokens
                if is_passed == "Y":
                    passed += 1
                elif is_passed == "N":
                    failed += 1
            except Exception as exc:  # noqa: BLE001 - per-case failure, keep going
                is_passed = "N"
                failed += 1
                session.add(
                    TestResult(
                        run_id=run_id,
                        case_id=case.case_id,
                        is_passed="N",
                        error_msg=str(exc)[:1000],
                    )
                )
            session.commit()
            await manager.broadcast(
                run_id,
                {
                    "event": "PROGRESS",
                    "run_id": run_id,
                    "done": idx,
                    "total": len(cases),
                    "case_id": case.case_id,
                    "is_passed": is_passed,
                },
            )

        run.status = "DONE"
        run.passed_cases = passed
        run.failed_cases = failed
        run.avg_latency_ms = int(lat_sum / lat_n) if lat_n else None
        run.total_tokens = tok_sum
        run.ended_dt = datetime.now(timezone.utc)
        session.commit()
        await manager.broadcast(
            run_id,
            {
                "event": "DONE",
                "run_id": run_id,
                "summary": {
                    "total": len(cases),
                    "passed": passed,
                    "failed": failed,
                    "avg_latency_ms": run.avg_latency_ms,
                    "total_tokens": tok_sum,
                },
            },
        )
    finally:
        session.close()
