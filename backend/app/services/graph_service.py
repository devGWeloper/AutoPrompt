from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.edge import NodeEdge
from app.models.node import Node
from app.models.prompt import PromptVersion
from app.schemas.graph import (
    ActiveModelSummary,
    ActivePromptSummary,
    EdgeOut,
    GraphOut,
    NodeOut,
)


def build_graph(db: Session, project_id: int) -> GraphOut:
    node_rows = (
        db.execute(
            select(Node).where(Node.project_id == project_id).order_by(Node.node_id.asc())
        )
        .scalars()
        .all()
    )

    edge_rows = (
        db.execute(
            select(NodeEdge).where(NodeEdge.project_id == project_id).order_by(NodeEdge.edge_id.asc())
        )
        .scalars()
        .all()
    )

    node_ids = [n.node_id for n in node_rows]
    active_prompts: dict[int, PromptVersion] = {}
    if node_ids:
        prompts = (
            db.execute(
                select(PromptVersion).where(
                    PromptVersion.node_id.in_(node_ids), PromptVersion.is_active == "Y"
                )
            )
            .scalars()
            .all()
        )
        for p in prompts:
            active_prompts[p.node_id] = p

    nodes_out: list[NodeOut] = []
    for n in node_rows:
        ap = active_prompts.get(n.node_id)
        nodes_out.append(
            NodeOut(
                node_id=n.node_id,
                project_id=n.project_id,
                node_key=n.node_key,
                node_nm=n.node_nm,
                node_type=n.node_type,
                pos_x=n.pos_x,
                pos_y=n.pos_y,
                description=n.description,
                active_prompt=(
                    ActivePromptSummary(prompt_id=ap.prompt_id, version_no=ap.version_no)
                    if ap
                    else None
                ),
                active_model=(
                    ActiveModelSummary(
                        model_provider=ap.model_provider,
                        model_nm=ap.model_nm,
                    )
                    if ap
                    else None
                ),
            )
        )

    edges_out = [EdgeOut.model_validate(e) for e in edge_rows]
    return GraphOut(nodes=nodes_out, edges=edges_out)
