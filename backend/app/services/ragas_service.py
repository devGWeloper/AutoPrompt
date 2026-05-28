from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from decimal import Decimal

from app.core.ws import manager
from app.models.ragas import RagasResult, RagasRun


def ws_key(ragas_run_id: int) -> str:
    """Namespaced WS channel so RAGAS ids never collide with other run ids."""
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


async def _record_ragas_failure(session, run: RagasRun, key: str, msg: str) -> None:
    """Mark a RAGAS run FAILED and leave an error row in PM_RAGAS_RESULT.

    Keeps failures visible in the results/records UI instead of vanishing.
    """
    run.status = "FAILED"
    run.error_msg = msg[:1000]
    run.ended_dt = datetime.now(timezone.utc)
    session.add(RagasResult(ragas_run_id=run.ragas_run_id, error_msg=msg[:1000]))
    session.commit()
    await manager.broadcast(key, {"event": "FAILED", "run_id": run.ragas_run_id, "error": msg})
