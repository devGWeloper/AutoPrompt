from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.constants import SYSTEM_USER
from app.core.db import get_db
from app.models.node import Node
from app.models.project import Project
from app.schemas.graph import GraphLayoutUpdate, GraphOut, ProjectOut
from app.services import audit as audit_service
from app.services.graph_service import build_graph

router = APIRouter(tags=["projects"])


@router.get("/projects", response_model=list[ProjectOut])
def list_projects(
    db: Session = Depends(get_db),
) -> list[ProjectOut]:
    rows = (
        db.execute(select(Project).order_by(Project.project_id.asc())).scalars().all()
    )
    return [ProjectOut.model_validate(r) for r in rows]


@router.get("/projects/{project_id}/graph", response_model=GraphOut)
def get_graph(
    project_id: int,
    db: Session = Depends(get_db),
) -> GraphOut:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="project not found")
    return build_graph(db, project_id)


@router.put("/projects/{project_id}/graph", response_model=GraphOut)
def update_graph_layout(
    project_id: int,
    payload: GraphLayoutUpdate,
    db: Session = Depends(get_db),
) -> GraphOut:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="project not found")
    if not payload.positions:
        return build_graph(db, project_id)

    node_ids = [p.node_id for p in payload.positions]
    nodes = (
        db.execute(select(Node).where(Node.project_id == project_id, Node.node_id.in_(node_ids)))
        .scalars()
        .all()
    )
    by_id = {n.node_id: n for n in nodes}

    updates_for_audit: list[dict] = []
    for upd in payload.positions:
        n = by_id.get(upd.node_id)
        if n is None:
            continue
        updates_for_audit.append(
            {
                "node_id": n.node_id,
                "before": {"pos_x": n.pos_x, "pos_y": n.pos_y},
                "after": {"pos_x": upd.pos_x, "pos_y": upd.pos_y},
            }
        )
        n.pos_x = upd.pos_x
        n.pos_y = upd.pos_y
    db.flush()

    audit_service.write_audit(
        db,
        target_table="PM_NODE",
        target_id=project_id,
        action="UPDATE",
        before=None,
        after={"layout_updates": updates_for_audit},
        created_by=SYSTEM_USER,
    )
    db.commit()
    return build_graph(db, project_id)
