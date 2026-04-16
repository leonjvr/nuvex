"""Dashboard FastAPI application factory."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from .routers import (
    agents,
    approvals,
    audit,
    channels,
    contacts,
    cron,
    costs,
    events,
    health_services,
    invoke,
    memory,
    orgs,
    outcomes,
    plugins,
    policy_candidates,
    principals,
    providers,
    skill_config,
    skill_importer,
    skills,
    tasks,
    threads,
    workspace,
)
from .routers.downloads import router as downloads_router
from .routers.device_tokens import router as device_tokens_router
from .routers.device_assignments import router as device_assignments_router


def create_app() -> FastAPI:
    app = FastAPI(title="NUVEX Dashboard API", version="0.1.0")

    app.include_router(agents.router)
    app.include_router(audit.router)
    app.include_router(orgs.router)
    app.include_router(channels.router)
    app.include_router(contacts.router)
    app.include_router(cron.router)
    app.include_router(costs.router)
    app.include_router(events.router)
    app.include_router(health_services.router)
    app.include_router(invoke.router)
    app.include_router(memory.router)
    app.include_router(providers.router)
    app.include_router(skill_config.router)
    app.include_router(skill_importer.router)
    app.include_router(skills.router)
    app.include_router(tasks.router)
    app.include_router(threads.router)
    app.include_router(workspace.router)
    app.include_router(outcomes.router)
    app.include_router(policy_candidates.router)
    app.include_router(approvals.router)
    app.include_router(principals.router)
    app.include_router(plugins.router)
    app.include_router(downloads_router)
    app.include_router(device_tokens_router)
    app.include_router(device_assignments_router)

    @app.get("/api/health")
    async def health():
        return {"status": "ok"}

    # Serve built frontend from /app directory
    frontend_dist = Path(__file__).parent / "frontend" / "dist"
    if frontend_dist.is_dir():
        assets_dir = frontend_dist / "assets"
        if assets_dir.is_dir():
            app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def serve_spa(full_path: str) -> FileResponse:
            file = frontend_dist / full_path
            if full_path and file.is_file():
                return FileResponse(str(file))
            return FileResponse(
                str(frontend_dist / "index.html"),
                headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
            )

    return app
