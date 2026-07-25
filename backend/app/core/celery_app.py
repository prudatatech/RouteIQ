"""Celery worker — async task queue for VRP jobs, ETA recalculation, etc."""
from celery import Celery
from app.core.config import settings

celery_app = Celery(
    "routeiq",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=[],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="Asia/Kolkata",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    beat_schedule={
        "recalculate-etas-every-2-minutes": {
            "task": "app.tasks.telemetry_tasks.recalculate_active_etas",
            "schedule": 120.0,
        },
        "check-rerouting-every-5-minutes": {
            "task": "app.tasks.optimization_tasks.check_rerouting_triggers",
            "schedule": 300.0,
        },
    },
)
