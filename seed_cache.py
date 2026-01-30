
import asyncio
import logging
import time
from pathlib import Path
from main import calculate_dividend_metrics, save_snapshot, SP500_TICKERS, executor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def seed_data():
    logger.info(f"Starting full seed data fetch for {len(SP500_TICKERS)} stocks...")
    
    loop = asyncio.get_running_loop()
    all_stocks = []
    batch_size = 20 # Smaller batch size to be safer with rate limits
    
    total_batches = (len(SP500_TICKERS) + batch_size - 1) // batch_size
    
    for i in range(0, len(SP500_TICKERS), batch_size):
        batch = SP500_TICKERS[i:i+batch_size]
        current_batch = i // batch_size + 1
        logger.info(f"Processing batch {current_batch}/{total_batches} ({len(batch)} tickers)...")
        
        futures = [
            loop.run_in_executor(executor, calculate_dividend_metrics, ticker)
            for ticker in batch
        ]
        results = await asyncio.gather(*futures)
        valid_results = [r for r in results if r is not None]
        all_stocks.extend(valid_results)
        
        logger.info(f"Batch {current_batch} complete. Found {len(valid_results)} dividend payers. Sleeping to respect rate limits...")
        await asyncio.sleep(2) # Sleep 2 seconds between batches

    # Save the snapshot
    if all_stocks:
        logger.info(f"Saving snapshot with {len(all_stocks)} stocks...")
        save_snapshot(all_stocks)
        logger.info("Seed complete! Full dataset saved to data/latest_snapshot.json")
    else:
        logger.error("No data fetched!")

if __name__ == "__main__":
    # Ensure data directory exists
    Path("data").mkdir(exist_ok=True)
    asyncio.run(seed_data())
