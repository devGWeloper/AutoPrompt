from fastapi import APIRouter

from app.api.v1 import (
    audit,
    datasets,
    exports,
    flow,
    prompts,
    ragas,
    test_runs,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(flow.router)
api_router.include_router(prompts.router)
api_router.include_router(datasets.router)
api_router.include_router(test_runs.router)
api_router.include_router(audit.router)
api_router.include_router(ragas.router)
api_router.include_router(exports.router)
