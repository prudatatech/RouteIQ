import asyncio
import logging
from app.core.database import AsyncSessionLocal
from app.services.spark_gps_service import SparkGPSService

logger = logging.getLogger("routeiq.spark_gps_task")

class SparkGPSTask:
    def __init__(self, interval_seconds: int = 30):
        self.interval_seconds = interval_seconds
        self._running = False

    async def start(self):
        self._running = True
        logger.info(f"SparkGPS Background Task started (Interval: {self.interval_seconds}s)")
        while self._running:
            try:
                async with AsyncSessionLocal() as db:
                    await SparkGPSService.fetch_and_sync(db)
                    await db.commit()
                    # Sync pulse for UI
                    from app.core.redis import cache_set
                    await cache_set("system:sparkgps:sync_pulse", "active", ttl=45)
            except Exception as e:
                logger.error(f"Error in SparkGPS sync task: {str(e)}")
            
            await asyncio.sleep(self.interval_seconds)

    async def stop(self):
        self._running = False
        logger.info("SparkGPS Background Task stopped.")

spark_gps_task = SparkGPSTask()
