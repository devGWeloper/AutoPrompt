from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import db as db_module
from app.core.ws import manager
from app.models.edge import NodeEdge
from app.models.node import Node
from app.models.project import Project
from app.models.prompt import PromptVersion
from app.models.test_run import TestResult, TestRun
from app.services.test_service import _adapter_for


def _topo_order(node_ids: list[int], edges: list[NodeEdge]) -> list[int]:
    """Kahn topological order; falls back to node_id order on cycles."""
    indeg = {nid: 0 for nid in node_ids}
    adj: dict[int, list[int]] = {nid: [] for nid in node_ids}
    for e in edges:
        if e.source_node_id in adj and e.target_node_id in indeg:
            adj[e.source_node_id].append(e.target_node_id)
            indeg[e.target_node_id] += 1
    queue = sorted([n for n, d in indeg.items() if d == 0])
    order: list[int] = []
    while queue:
        cur = queue.pop(0)
        order.append(cur)
        for nxt in adj[cur]:
            indeg[nxt] -= 1
            if indeg[nxt] == 0:
                queue.append(nxt)
        queue.sort()
    if len(order) != len(node_ids):  # cycle — fall back to stable order
        return sorted(node_ids)
    return order


def create_flow_run(db: Session, *, project_id: int, actor: str) -> TestRun:
    if db.get(Project, project_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="project not found")
    node_ids = (
        db.execute(select(Node.node_id).where(Node.project_id == project_id))
        .scalars()
        .all()
    )
    if not node_ids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="project has no nodes")
    active = (
        db.execute(
            select(PromptVersion.node_id).where(
                PromptVersion.node_id.in_(node_ids), PromptVersion.is_active == "Y"
            )
        )
        .scalars()
        .all()
    )
    run = TestRun(
        run_type="FLOW",
        project_id=project_id,
        status="PENDING",
        total_cases=len(set(active)),
        created_by=actor,
    )
    db.add(run)
    db.flush()
    return run


async def execute_flow_run(
    *, run_id: int, project_id: int, variables: dict[str, str]
) -> None:
    """Run the project graph node-by-node (topological), feeding a shared context."""
    session = db_module.SessionLocal()
    try:
        run = session.get(TestRun, run_id)
        if run is None:
            return
        nodes = (
            session.execute(select(Node).where(Node.project_id == project_id))
            .scalars()
            .all()
        )
        edges = (
            session.execute(
                select(NodeEdge).where(NodeEdge.project_id == project_id)
            )
            .scalars()
            .all()
        )
        by_id = {n.node_id: n for n in nodes}
        active_prompts = {
            p.node_id: p
            for p in session.execute(
                select(PromptVersion).where(
                    PromptVersion.node_id.in_(list(by_id)),
                    PromptVersion.is_active == "Y",
                )
            ).scalars()
        }
        order = _topo_order(list(by_id), list(edges))

        run.status = "RUNNING"
        run.started_dt = datetime.now(timezone.utc)
        session.commit()
        await manager.broadcast(
            run_id, {"event": "RUNNING", "run_id": run_id, "order": order}
        )

        context: dict[str, str] = dict(variables)
        executed = lat_sum = tok_sum = 0
        for node_id in order:
            node = by_id[node_id]
            await manager.broadcast(
                run_id,
                {
                    "event": "NODE_RUNNING",
                    "run_id": run_id,
                    "node_id": node_id,
                    "node_key": node.node_key,
                },
            )
            prompt = active_prompts.get(node_id)
            if prompt is None:
                await manager.broadcast(
                    run_id,
                    {
                        "event": "NODE_DONE",
                        "run_id": run_id,
                        "node_id": node_id,
                        "node_key": node.node_key,
                        "skipped": True,
                    },
                )
                continue
            try:
                adapter = _adapter_for(prompt)
                result = await adapter.invoke(
                    system_prompt=prompt.system_prompt,
                    user_prompt=prompt.user_prompt,
                    variables=context,
                )
            except Exception as exc:  # noqa: BLE001 - node failure aborts flow
                session.add(
                    TestResult(
                        run_id=run_id,
                        case_id=None,
                        is_passed="N",
                        eval_detail=json.dumps(
                            {"node_id": node_id, "node_key": node.node_key}
                        ),
                        error_msg=str(exc)[:1000],
                    )
                )
                run.status = "FAILED"
                run.failed_cases = 1
                run.ended_dt = datetime.now(timezone.utc)
                session.commit()
                await manager.broadcast(
                    run_id,
                    {
                        "event": "FAILED",
                        "run_id": run_id,
                        "node_id": node_id,
                        "error": str(exc),
                    },
                )
                return

            session.add(
                TestResult(
                    run_id=run_id,
                    case_id=None,
                    actual_output=result.output,
                    eval_detail=json.dumps(
                        {"node_id": node_id, "node_key": node.node_key}
                    ),
                    latency_ms=result.latency_ms,
                    input_tokens=result.input_tokens,
                    output_tokens=result.output_tokens,
                )
            )
            session.commit()
            context[node.node_key] = result.output
            context["last_output"] = result.output
            executed += 1
            lat_sum += result.latency_ms
            tok_sum += result.input_tokens + result.output_tokens
            await manager.broadcast(
                run_id,
                {
                    "event": "NODE_DONE",
                    "run_id": run_id,
                    "node_id": node_id,
                    "node_key": node.node_key,
                    "output": result.output,
                    "latency_ms": result.latency_ms,
                    "tokens": result.input_tokens + result.output_tokens,
                },
            )

        run.status = "DONE"
        run.passed_cases = executed
        run.avg_latency_ms = int(lat_sum / executed) if executed else None
        run.total_tokens = tok_sum
        run.ended_dt = datetime.now(timezone.utc)
        session.commit()
        await manager.broadcast(
            run_id,
            {
                "event": "DONE",
                "run_id": run_id,
                "summary": {
                    "nodes_executed": executed,
                    "avg_latency_ms": run.avg_latency_ms,
                    "total_tokens": tok_sum,
                },
            },
        )
    finally:
        session.close()
