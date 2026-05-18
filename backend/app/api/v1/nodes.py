from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.constants import SYSTEM_USER
from app.core.db import get_db
from app.models.node import Node
from app.models.project import Project
from app.schemas.graph import NodeCreate, NodeOut, NodeUpdate
from app.services import audit as audit_service
from app.services.graph_service import build_graph

router = APIRouter(tags=["nodes"])


@router.get("/projects/{project_id}/nodes", response_model=list[NodeOut])
def list_nodes(
    project_id: int,
    db: Session = Depends(get_db),
) -> list[NodeOut]:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="project not found")
    return build_graph(db, project_id).nodes


@router.post("/projects/{project_id}/nodes", response_model=NodeOut, status_code=status.HTTP_201_CREATED)
def create_node(
    project_id: int,
    payload: NodeCreate,
    db: Session = Depends(get_db),
) -> NodeOut:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="project not found")

    existing = (
        db.execute(
            select(Node).where(Node.project_id == project_id, Node.node_key == payload.node_key)
        )
        .scalars()
        .first()
    )
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="node_key already exists in project")

    node = Node(
        project_id=project_id,
        node_key=payload.node_key,
        node_nm=payload.node_nm,
        node_type=payload.node_type,
        pos_x=payload.pos_x,
        pos_y=payload.pos_y,
        description=payload.description,
        created_by=SYSTEM_USER,
    )
    db.add(node)
    db.flush()

    audit_service.write_audit(
        db,
        target_table="PM_NODE",
        target_id=node.node_id,
        action="CREATE",
        before=None,
        after={
            "node_id": node.node_id,
            "node_key": node.node_key,
            "node_nm": node.node_nm,
            "node_type": node.node_type,
        },
        created_by=SYSTEM_USER,
    )
    db.commit()
    return NodeOut.model_validate(node)


@router.put("/nodes/{node_id}", response_model=NodeOut)
def update_node(
    node_id: int,
    payload: NodeUpdate,
    db: Session = Depends(get_db),
) -> NodeOut:
    node = db.get(Node, node_id)
    if node is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="node not found")

    before = {
        "node_nm": node.node_nm,
        "node_type": node.node_type,
        "pos_x": node.pos_x,
        "pos_y": node.pos_y,
        "description": node.description,
    }
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(node, field, value)
    db.flush()
    after = {
        "node_nm": node.node_nm,
        "node_type": node.node_type,
        "pos_x": node.pos_x,
        "pos_y": node.pos_y,
        "description": node.description,
    }
    audit_service.write_audit(
        db,
        target_table="PM_NODE",
        target_id=node.node_id,
        action="UPDATE",
        before=before,
        after=after,
        created_by=SYSTEM_USER,
    )
    db.commit()
    return NodeOut.model_validate(node)
