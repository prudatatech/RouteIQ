"""
ROUTEIQ powered by PRUDATA TECHNOLOGIES - Fleet Intelligence Platform
FastAPI Application Entry Point
"""
from contextlib import asynccontextmanager
import asyncio

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import os
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from prometheus_client import make_asgi_app

from .api.v1.router import api_router
from app.core.config import settings
from app.core.database import engine, Base

from app.core.redis import redis_client
from app.core.logging import setup_logging
from app.middleware.metrics import PrometheusMiddleware
from app.middleware.request_id import RequestIDMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown lifecycle."""
    setup_logging()

    # Create DB tables (retry on transient asyncpg connection errors)
    import logging as _logging
    for _attempt in range(5):
        try:
            async with engine.connect() as conn:
                await conn.run_sync(Base.metadata.create_all)
                await conn.commit()
            break
        except Exception as _e:
            _logging.getLogger("uvicorn").warning(
                f"DB startup attempt {_attempt + 1}/5 failed: {_e}. Retrying..."
            )
            if _attempt == 4:
                raise
            await asyncio.sleep(2)

    # Connect Redis (non-fatal — app works without cache)
    try:
        await redis_client.ping()
        import logging
        logging.getLogger("uvicorn").info("Redis connected successfully")
    except Exception as e:
        import logging
        logging.getLogger("uvicorn").warning(f"Redis unavailable: {e}. Continuing without cache.")

    # Start Fleet Health Monitoring
    from app.services.fleet_health import fleet_health_monitor
    from app.services.spark_gps_task import spark_gps_task

    asyncio.create_task(fleet_health_monitor.start())
    if settings.ENABLE_HARDWARE_SYNC:
        asyncio.create_task(spark_gps_task.start())

    yield

    # Cleanup
    await fleet_health_monitor.stop()
    if settings.ENABLE_HARDWARE_SYNC:
        await spark_gps_task.stop()
    await redis_client.close()
    await engine.dispose()


app = FastAPI(
    title=settings.APP_NAME,
    openapi_url="/api/v1/openapi.json",
    lifespan=lifespan,
    redirect_slashes=True,
)

# Middleware (order matters — outermost first)
app.add_middleware(RequestIDMiddleware)
app.add_middleware(PrometheusMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Prometheus metrics endpoint
metrics_app = make_asgi_app()
app.mount("/metrics", metrics_app)

# Add Unified API Router
app.include_router(api_router, prefix="/api/v1")

# Serve SPA built files (fallback for client-side routing)
frontend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../frontend/dist"))
if os.path.exists(frontend_path):
    app.mount("/", StaticFiles(directory=frontend_path, html=True))
else:
    import logging
    logging.getLogger("uvicorn").warning(f"Frontend path {frontend_path} not found. Skipping static files mounting.")


@app.get("/health", tags=["Health"])
async def health_check():
    return {
        "status": "healthy",
        "app": settings.APP_NAME,
        "version": "1.0.0",
    }


@app.get("/ready", tags=["Health"])
async def readiness_check():
    try:
        await redis_client.ping()
        return {"status": "ready", "redis": "ok", "database": "ok"}
    except Exception as e:
        return {"status": "not_ready", "error": str(e)}
