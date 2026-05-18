"""Phase 1 seed loader (no auth — single trusted-environment deployment).

Usage:
    python -m scripts.seed_phase1
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select

from app.core.db import SessionLocal
from app.models.edge import NodeEdge
from app.models.node import Node
from app.models.project import Project
from app.models.prompt import PromptVersion
from app.models.prompt_variable import PromptVariable


def seed() -> None:
    db = SessionLocal()
    try:
        if db.execute(select(Project)).scalar_one_or_none() is None:
            project = Project(
                project_nm="Customer Support Agent",
                description="Demo AI Agent for customer inquiries",
                created_by="system",
            )
            db.add(project)
            db.flush()

            nodes = [
                Node(project_id=project.project_id, node_key="start", node_nm="Start", node_type="START", pos_x=100, pos_y=200, created_by="system"),
                Node(project_id=project.project_id, node_key="router", node_nm="Intent Router", node_type="ROUTER", pos_x=300, pos_y=200, created_by="system"),
                Node(project_id=project.project_id, node_key="it_responder", node_nm="IT Responder", node_type="LLM", pos_x=550, pos_y=100, created_by="system"),
                Node(project_id=project.project_id, node_key="general_responder", node_nm="General Responder", node_type="LLM", pos_x=550, pos_y=300, created_by="system"),
                Node(project_id=project.project_id, node_key="end", node_nm="End", node_type="END", pos_x=800, pos_y=200, created_by="system"),
            ]
            db.add_all(nodes)
            db.flush()
            start, router_n, it_n, general_n, end_n = nodes

            db.add_all(
                [
                    NodeEdge(project_id=project.project_id, source_node_id=start.node_id, target_node_id=router_n.node_id),
                    NodeEdge(project_id=project.project_id, source_node_id=router_n.node_id, target_node_id=it_n.node_id, label="IT"),
                    NodeEdge(project_id=project.project_id, source_node_id=router_n.node_id, target_node_id=general_n.node_id, label="General"),
                    NodeEdge(project_id=project.project_id, source_node_id=it_n.node_id, target_node_id=end_n.node_id),
                    NodeEdge(project_id=project.project_id, source_node_id=general_n.node_id, target_node_id=end_n.node_id),
                ]
            )

            prompts = [
                PromptVersion(
                    node_id=router_n.node_id, version_no="1.0.0",
                    system_prompt="You classify customer inquiries into IT or General.",
                    user_prompt="Inquiry: {{inquiry_text}}\nReply with exactly one word: IT or General.",
                    model_provider="anthropic", model_nm="claude-haiku-4-5-20251001",
                    temperature=Decimal("0.0"), max_tokens=256,
                    is_active="Y", change_summary="Initial version", change_reason="Initial baseline", created_by="system",
                ),
                PromptVersion(
                    node_id=it_n.node_id, version_no="1.0.0",
                    system_prompt="You are an IT support specialist. Provide accurate, concise help.",
                    user_prompt="User question: {{inquiry_text}}",
                    model_provider="anthropic", model_nm="claude-sonnet-4-6",
                    temperature=Decimal("0.3"), max_tokens=1024,
                    is_active="Y", change_summary="Initial version", change_reason="Initial baseline", created_by="system",
                ),
                PromptVersion(
                    node_id=general_n.node_id, version_no="1.0.0",
                    system_prompt="You are a friendly customer support agent.",
                    user_prompt="Question: {{inquiry_text}}\nCustomer name: {{customer_name}}",
                    model_provider="anthropic", model_nm="claude-sonnet-4-6",
                    temperature=Decimal("0.5"), max_tokens=1024,
                    is_active="Y", change_summary="Initial version", change_reason="Initial baseline", created_by="system",
                ),
            ]
            db.add_all(prompts)
            db.flush()
            for p in prompts:
                db.add(PromptVariable(prompt_id=p.prompt_id, var_name="inquiry_text", description="Raw inquiry"))
            db.add(PromptVariable(prompt_id=prompts[2].prompt_id, var_name="customer_name", description="Customer name", is_required="N"))

        db.commit()
        print("Seed complete.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
