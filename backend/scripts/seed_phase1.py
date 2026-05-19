"""Demo seed loader (no auth — single trusted-environment deployment).

This Python module is the canonical seeder. (The old ``sql/seed_phase1.sql``
was removed — it referenced deleted PM_USER / PM_MODEL_CONFIG tables.)

Usage:
    python -m scripts.seed_phase1            # idempotent: skip if a Project exists
    python -m scripts.seed_phase1 --reset    # wipe all PM_* demo data, then reseed
"""
from __future__ import annotations

import argparse
import json
from decimal import Decimal

from sqlalchemy import delete, select

from app.core.db import SessionLocal
from app.models.audit import AuditLog
from app.models.dataset import TestCase, TestDataset
from app.models.edge import NodeEdge
from app.models.node import Node
from app.models.project import Project
from app.models.prompt import PromptVersion
from app.models.prompt_variable import PromptVariable
from app.models.ragas import RagasResult, RagasRun
from app.models.test_run import TestResult, TestRun

# FK-safe delete order (children first).
_RESET_ORDER = [
    RagasResult,
    RagasRun,
    TestResult,
    TestRun,
    TestCase,
    TestDataset,
    AuditLog,
    PromptVariable,
    PromptVersion,
    NodeEdge,
    Node,
    Project,
]

# RAGAS golden cases for the IT Knowledge Base (RAG) node. Each input_data is a
# JSON object with question / contexts / ground_truth — exactly what
# ragas_service._parse_case() and _case_variables() consume.
_IT_KB_CASES = [
    {
        "question": "How do I reset my corporate password?",
        "contexts": [
            "To reset your corporate password, open https://id.corp.example.com "
            "and click 'Forgot password'. A reset link is emailed to your "
            "registered address and expires in 15 minutes.",
            "Passwords must be at least 12 characters and cannot reuse the last "
            "5 passwords.",
        ],
        "ground_truth": (
            "Go to https://id.corp.example.com, click 'Forgot password', and use "
            "the emailed reset link within 15 minutes."
        ),
    },
    {
        "question": "What client do I use to connect to the company VPN?",
        "contexts": [
            "The company VPN uses the GlobalProtect client. Download it from the "
            "self-service portal and sign in with your corporate SSO account.",
            "VPN access requires an enrolled MFA device.",
        ],
        "ground_truth": (
            "Use the GlobalProtect client from the self-service portal and sign "
            "in with corporate SSO (MFA required)."
        ),
    },
    {
        "question": "My printer shows offline. How do I fix it?",
        "contexts": [
            "If a network printer shows offline, first confirm it is powered on "
            "and connected to the LAN. Then remove and re-add the printer using "
            "the print server path \\\\print.corp.example.com.",
            "Restarting the Print Spooler service resolves most stuck-offline "
            "states on Windows.",
        ],
        "ground_truth": (
            "Check power/LAN, re-add the printer via \\\\print.corp.example.com, "
            "and restart the Print Spooler service."
        ),
    },
    {
        "question": "My mailbox is full and I cannot send email. What should I do?",
        "contexts": [
            "The default mailbox quota is 50 GB. When exceeded, sending is "
            "blocked while receiving continues for 7 days.",
            "Use the Online Archive or empty Deleted Items / Sent Items to free "
            "space; quota increases require a manager-approved ticket.",
        ],
        "ground_truth": (
            "Free space via Online Archive or by clearing Deleted/Sent Items; a "
            "quota increase needs a manager-approved ticket."
        ),
    },
    {
        "question": "How do I enroll a new phone for multi-factor authentication?",
        "contexts": [
            "To enroll an MFA device, sign in to https://id.corp.example.com, go "
            "to Security > MFA devices, choose 'Add device', and scan the QR code "
            "with the Authenticator app.",
            "You must keep at least one backup method (SMS or backup codes).",
        ],
        "ground_truth": (
            "At https://id.corp.example.com go to Security > MFA devices > Add "
            "device, scan the QR with the Authenticator app, and keep a backup "
            "method."
        ),
    },
]


def reset(db) -> None:
    for model in _RESET_ORDER:
        db.execute(delete(model))
    db.commit()
    print("Reset complete (all PM_* demo data deleted).")


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
                Node(
                    project_id=project.project_id,
                    node_key="it_responder",
                    node_nm="IT Knowledge Base (RAG)",
                    node_type="LLM",
                    pos_x=550,
                    pos_y=100,
                    description="RAG node: answers IT questions grounded in retrieved knowledge-base context.",
                    created_by="system",
                ),
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

            router_prompt = PromptVersion(
                node_id=router_n.node_id, version_no="1.0.0",
                system_prompt="You classify customer inquiries into IT or General.",
                user_prompt="Inquiry: {{inquiry_text}}\nReply with exactly one word: IT or General.",
                model_provider="anthropic", model_nm="claude-haiku-4-5-20251001",
                temperature=Decimal("0.0"), max_tokens=256,
                is_active="Y", change_summary="Initial version", change_reason="Initial baseline", created_by="system",
            )
            it_prompt = PromptVersion(
                node_id=it_n.node_id, version_no="1.0.0",
                system_prompt=(
                    "You are an IT support assistant. Answer the question using "
                    "ONLY the provided context. If the answer is not in the "
                    "context, say you don't know — do not invent details."
                ),
                user_prompt="Context:\n{{contexts}}\n\nQuestion: {{question}}\nAnswer:",
                model_provider="google", model_nm="gemini-1.5-flash",
                temperature=Decimal("0.0"), max_tokens=1024,
                is_active="Y", change_summary="Initial version", change_reason="RAG-grounded IT responder", created_by="system",
            )
            general_prompt = PromptVersion(
                node_id=general_n.node_id, version_no="1.0.0",
                system_prompt="You are a friendly customer support agent.",
                user_prompt="Question: {{inquiry_text}}\nCustomer name: {{customer_name}}",
                model_provider="anthropic", model_nm="claude-sonnet-4-6",
                temperature=Decimal("0.5"), max_tokens=1024,
                is_active="Y", change_summary="Initial version", change_reason="Initial baseline", created_by="system",
            )
            db.add_all([router_prompt, it_prompt, general_prompt])
            db.flush()

            db.add_all(
                [
                    PromptVariable(prompt_id=router_prompt.prompt_id, var_name="inquiry_text", description="Raw inquiry"),
                    PromptVariable(prompt_id=it_prompt.prompt_id, var_name="question", description="User IT question"),
                    PromptVariable(prompt_id=it_prompt.prompt_id, var_name="contexts", description="Retrieved knowledge-base context"),
                    PromptVariable(prompt_id=general_prompt.prompt_id, var_name="inquiry_text", description="Raw inquiry"),
                    PromptVariable(prompt_id=general_prompt.prompt_id, var_name="customer_name", description="Customer name", is_required="N"),
                ]
            )

            # RAGAS golden dataset on the RAG node.
            dataset = TestDataset(
                node_id=it_n.node_id,
                dataset_nm="IT KB Golden Set",
                description="RAGAS evaluation golden set (question / contexts / ground_truth)",
                is_active="Y",
                created_by="system",
            )
            db.add(dataset)
            db.flush()
            for c in _IT_KB_CASES:
                db.add(
                    TestCase(
                        dataset_id=dataset.dataset_id,
                        input_data=json.dumps(
                            {
                                "question": c["question"],
                                "contexts": c["contexts"],
                                "ground_truth": c["ground_truth"],
                            },
                            ensure_ascii=False,
                        ),
                        expected_output=c["ground_truth"],
                        case_type="NORMAL",
                        created_by="system",
                    )
                )

        db.commit()
        print("Seed complete.")
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Demo seed loader")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Delete all PM_* demo data before seeding (destructive).",
    )
    args = parser.parse_args()

    if args.reset:
        db = SessionLocal()
        try:
            reset(db)
        finally:
            db.close()

    seed()


if __name__ == "__main__":
    main()
