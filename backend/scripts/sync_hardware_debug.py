
import asyncio
import sys
import os
import logging

# Add parent directory to path to import app
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import AsyncSessionLocal
from app.services.spark_gps_service import SparkGPSService

# Configure logging to capture everything
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    filename='sync_debug.log',
    filemode='w'
)
logger = logging.getLogger("routeiq.sync_script")

async def run_manual_sync():
    logger.info("Starting manual hardware sync debug version...")
    async with AsyncSessionLocal() as db:
        try:
            await SparkGPSService.fetch_and_sync(db)
            await db.commit()
            logger.info("Manual sync completed.")
        except Exception as e:
            logger.error(f"Sync failed: {str(e)}")

if __name__ == "__main__":
    asyncio.run(run_manual_sync())
