from fastapi import APIRouter

from app.api.v1 import (
    audit,
    datasets,
    flow,
    nodes,
    projects,
    prompts,
    test_runs,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(projects.router)
api_router.include_router(nodes.router)
api_router.include_router(prompts.router)
api_router.include_router(datasets.router)
api_router.include_router(test_runs.router)
api_router.include_router(flow.router)
api_router.include_router(audit.router)
