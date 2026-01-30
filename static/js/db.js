/**
 * ============================================================================
 * DIVIDEND HUNTER - IndexedDB Manager
 * ============================================================================
 * Handles all local data persistence:
 * - Portfolio (saved stocks)
 * - Swipe history (to avoid showing already-seen stocks)
 * - Cached stock data (for offline use)
 * - Trend snapshots (historical data for analysis)
 * 
 * Design notes:
 * - Uses a single database with multiple object stores
 * - Implements cleanup routines to prevent unbounded growth
 * - All operations are async/Promise-based
 * - Gracefully degrades if IndexedDB is unavailable
 */

const DividendDB = (function () {
    'use strict';

    // ========================================================================
    // CONFIGURATION
    // ========================================================================

    const DB_NAME = 'dividend-hunter';
    const DB_VERSION = 1;

    // Object store names - think of these as tables
    const STORES = {
        PORTFOLIO: 'portfolio',       // Saved stocks
        HISTORY: 'swipeHistory',      // What user has seen
        STOCKS: 'stockCache',         // Cached stock data
        TRENDS: 'trendData',          // Historical snapshots
        SETTINGS: 'settings'          // User preferences
    };

    // Limits to prevent IndexedDB from growing unbounded
    const LIMITS = {
        MAX_HISTORY: 2000,           // Max swipe history entries
        MAX_TREND_DAYS: 90,          // Days of trend data to keep
        CACHE_TTL: 3600000           // 1 hour in milliseconds
    };

    let db = null;

    // ========================================================================
    // DATABASE INITIALIZATION
    // ========================================================================

    /**
     * Opens the database and creates object stores if needed.
     * Call this once at app startup.
     */
    async function init() {
        if (db) return db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => {
                console.error('[DB] Failed to open:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                db = request.result;
                console.log('[DB] Opened successfully');
                resolve(db);
            };

            // This runs when the database is created or version changes
            request.onupgradeneeded = (event) => {
                const database = event.target.result;
                console.log('[DB] Upgrading schema...');

                // Portfolio store - keyed by ticker
                if (!database.objectStoreNames.contains(STORES.PORTFOLIO)) {
                    const portfolioStore = database.createObjectStore(STORES.PORTFOLIO, { keyPath: 'ticker' });
                    portfolioStore.createIndex('addedAt', 'addedAt', { unique: false });
                    portfolioStore.createIndex('yield', 'dividendYield', { unique: false });
                }

                // Swipe history - keyed by ticker, stores direction and timestamp
                if (!database.objectStoreNames.contains(STORES.HISTORY)) {
                    const historyStore = database.createObjectStore(STORES.HISTORY, { keyPath: 'ticker' });
                    historyStore.createIndex('timestamp', 'timestamp', { unique: false });
                    historyStore.createIndex('action', 'action', { unique: false });
                }

                // Stock cache - full stock data for offline use
                if (!database.objectStoreNames.contains(STORES.STOCKS)) {
                    const stockStore = database.createObjectStore(STORES.STOCKS, { keyPath: 'ticker' });
                    stockStore.createIndex('fetchedAt', 'fetchedAt', { unique: false });
                    stockStore.createIndex('category', 'category', { unique: false });
                    stockStore.createIndex('rankScore', 'rankScore', { unique: false });
                }

                // Trend data - historical snapshots for charts
                if (!database.objectStoreNames.contains(STORES.TRENDS)) {
                    const trendStore = database.createObjectStore(STORES.TRENDS, { keyPath: 'id' });
                    trendStore.createIndex('ticker', 'ticker', { unique: false });
                    trendStore.createIndex('date', 'date', { unique: false });
                }

                // Settings - simple key/value store
                if (!database.objectStoreNames.contains(STORES.SETTINGS)) {
                    database.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
                }
            };
        });
    }

    // ========================================================================
    // GENERIC CRUD HELPERS
    // ========================================================================

    /**
     * Gets a single item from a store by key.
     */
    async function getItem(storeName, key) {
        await init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.get(key);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Gets all items from a store.
     */
    async function getAllItems(storeName) {
        await init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Puts (upserts) an item into a store.
     */
    async function putItem(storeName, item) {
        await init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.put(item);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Deletes an item from a store by key.
     */
    async function deleteItem(storeName, key) {
        await init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.delete(key);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Clears all items from a store.
     */
    async function clearStore(storeName) {
        await init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // ========================================================================
    // PORTFOLIO OPERATIONS
    // ========================================================================

    /**
     * Adds a stock to the portfolio.
     * Enriches with addedAt timestamp.
     */
    async function addToPortfolio(stock) {
        const entry = {
            ...stock,
            addedAt: Date.now()
        };
        await putItem(STORES.PORTFOLIO, entry);
        console.log(`[DB] Added to portfolio: ${stock.ticker}`);
        return entry;
    }

    /**
     * Removes a stock from the portfolio.
     */
    async function removeFromPortfolio(ticker) {
        await deleteItem(STORES.PORTFOLIO, ticker);
        console.log(`[DB] Removed from portfolio: ${ticker}`);
    }

    /**
     * Gets all portfolio stocks.
     */
    async function getPortfolio() {
        const items = await getAllItems(STORES.PORTFOLIO);
        // Sort by when added, newest first
        return items.sort((a, b) => b.addedAt - a.addedAt);
    }

    /**
     * Checks if a stock is in the portfolio.
     */
    async function isInPortfolio(ticker) {
        const item = await getItem(STORES.PORTFOLIO, ticker);
        return !!item;
    }

    /**
     * Gets portfolio statistics.
     */
    async function getPortfolioStats() {
        const portfolio = await getPortfolio();

        if (portfolio.length === 0) {
            return { count: 0, avgYield: 0, totalAnnualDividend: 0 };
        }

        const totalYield = portfolio.reduce((sum, stock) => sum + (stock.dividendYield || 0), 0);
        const avgYield = totalYield / portfolio.length;

        return {
            count: portfolio.length,
            avgYield: avgYield.toFixed(2),
            totalAnnualDividend: portfolio.reduce((sum, stock) => sum + (stock.annualDividend || 0), 0).toFixed(2)
        };
    }

    // ========================================================================
    // SWIPE HISTORY OPERATIONS
    // ========================================================================

    /**
     * Records a swipe action (like or pass).
     */
    async function recordSwipe(ticker, action) {
        const entry = {
            ticker,
            action, // 'like' or 'pass'
            timestamp: Date.now()
        };
        await putItem(STORES.HISTORY, entry);

        // Cleanup if history is too large
        await cleanupHistory();
    }

    /**
     * Gets swipe history for filtering out already-seen stocks.
     * Returns a Set of tickers for fast lookup.
     */
    async function getSwipedTickers() {
        const items = await getAllItems(STORES.HISTORY);
        return new Set(items.map(item => item.ticker));
    }

    /**
     * Gets the last N swipes for undo functionality.
     */
    async function getRecentSwipes(count = 10) {
        const items = await getAllItems(STORES.HISTORY);
        return items
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, count);
    }

    /**
     * Removes a swipe from history (for undo).
     */
    async function removeSwipe(ticker) {
        await deleteItem(STORES.HISTORY, ticker);
    }

    /**
     * Clears all swipe history.
     */
    async function clearHistory() {
        await clearStore(STORES.HISTORY);
        console.log('[DB] Swipe history cleared');
    }

    /**
     * Clears all portfolio items.
     */
    async function clearPortfolio() {
        await clearStore(STORES.PORTFOLIO);
        console.log('[DB] Portfolio cleared');
    }

    /**
     * Removes old history entries to prevent unbounded growth.
     * Uses FIFO - removes oldest entries when over limit.
     */
    async function cleanupHistory() {
        const items = await getAllItems(STORES.HISTORY);

        if (items.length <= LIMITS.MAX_HISTORY) {
            return; // Within limits, nothing to do
        }

        // Sort by timestamp, oldest first
        items.sort((a, b) => a.timestamp - b.timestamp);

        // Calculate how many to remove
        const removeCount = items.length - LIMITS.MAX_HISTORY;
        const toRemove = items.slice(0, removeCount);

        // Delete old entries
        for (const item of toRemove) {
            await deleteItem(STORES.HISTORY, item.ticker);
        }

        console.log(`[DB] Cleaned up ${removeCount} old history entries`);
    }

    // ========================================================================
    // STOCK CACHE OPERATIONS
    // ========================================================================

    /**
     * Caches stock data for offline use.
     */
    async function cacheStocks(stocks) {
        await init();
        const tx = db.transaction(STORES.STOCKS, 'readwrite');
        const store = tx.objectStore(STORES.STOCKS);

        const now = Date.now();
        for (const stock of stocks) {
            store.put({
                ...stock,
                cachedAt: now
            });
        }

        return new Promise((resolve, reject) => {
            tx.oncomplete = () => {
                console.log(`[DB] Cached ${stocks.length} stocks`);
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        });
    }

    /**
     * Gets cached stocks, optionally filtered.
     * Returns null if cache is stale.
     */
    async function getCachedStocks(options = {}) {
        const { category, minYield, minSafety, checkFreshness = true } = options;

        let stocks = await getAllItems(STORES.STOCKS);

        // Check cache freshness
        if (checkFreshness && stocks.length > 0) {
            const oldest = Math.min(...stocks.map(s => s.cachedAt || 0));
            if (Date.now() - oldest > LIMITS.CACHE_TTL) {
                console.log('[DB] Cache is stale');
                return null;
            }
        }

        // Apply filters
        if (category && category !== 'all') {
            stocks = stocks.filter(s => s.category === category);
        }

        if (minYield) {
            stocks = stocks.filter(s => s.dividendYield >= minYield);
        }

        if (minSafety) {
            stocks = stocks.filter(s => s.safetyScore >= minSafety);
        }

        // Sort by rank score
        stocks.sort((a, b) => (b.rankScore || 0) - (a.rankScore || 0));

        return stocks;
    }

    /**
     * Gets a single cached stock by ticker.
     */
    async function getCachedStock(ticker) {
        return await getItem(STORES.STOCKS, ticker);
    }

    /**
     * Clears the stock cache.
     */
    async function clearStockCache() {
        await clearStore(STORES.STOCKS);
        console.log('[DB] Stock cache cleared');
    }

    // ========================================================================
    // TREND DATA OPERATIONS
    // ========================================================================

    /**
     * Saves a trend snapshot for a stock.
     * Used for historical analysis charts.
     */
    async function saveTrendSnapshot(ticker, data) {
        const today = new Date().toISOString().split('T')[0];
        const entry = {
            id: `${ticker}-${today}`, // Unique per ticker per day
            ticker,
            date: today,
            yield: data.dividendYield,
            price: data.price,
            growthRate: data.growthRate,
            safetyScore: data.safetyScore,
            savedAt: Date.now()
        };
        await putItem(STORES.TRENDS, entry);
    }

    /**
     * Gets trend data for a specific stock.
     */
    async function getTrendData(ticker) {
        await init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORES.TRENDS, 'readonly');
            const store = tx.objectStore(STORES.TRENDS);
            const index = store.index('ticker');
            const request = index.getAll(ticker);

            request.onsuccess = () => {
                const results = request.result || [];
                // Sort by date ascending for charts
                results.sort((a, b) => a.date.localeCompare(b.date));
                resolve(results);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Gets all tickers that have trend data.
     */
    async function getTickersWithTrends() {
        const items = await getAllItems(STORES.TRENDS);
        return [...new Set(items.map(item => item.ticker))];
    }

    /**
     * Cleans up old trend data (older than LIMITS.MAX_TREND_DAYS).
     */
    async function cleanupTrends() {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - LIMITS.MAX_TREND_DAYS);
        const cutoff = cutoffDate.toISOString().split('T')[0];

        const items = await getAllItems(STORES.TRENDS);
        const toRemove = items.filter(item => item.date < cutoff);

        for (const item of toRemove) {
            await deleteItem(STORES.TRENDS, item.id);
        }

        if (toRemove.length > 0) {
            console.log(`[DB] Cleaned up ${toRemove.length} old trend entries`);
        }
    }

    // ========================================================================
    // SETTINGS OPERATIONS
    // ========================================================================

    /**
     * Gets a setting value.
     */
    async function getSetting(key, defaultValue = null) {
        const item = await getItem(STORES.SETTINGS, key);
        return item ? item.value : defaultValue;
    }

    /**
     * Sets a setting value.
     */
    async function setSetting(key, value) {
        await putItem(STORES.SETTINGS, { key, value });
    }

    /**
     * Gets all settings as an object.
     */
    async function getAllSettings() {
        const items = await getAllItems(STORES.SETTINGS);
        const settings = {};
        for (const item of items) {
            settings[item.key] = item.value;
        }
        return settings;
    }

    // ========================================================================
    // EXPORT FUNCTIONALITY
    // ========================================================================

    /**
     * Exports portfolio to CSV format.
     */
    async function exportPortfolioCSV() {
        const portfolio = await getPortfolio();

        if (portfolio.length === 0) {
            return null;
        }

        const headers = [
            'Ticker',
            'Company Name',
            'Sector',
            'Dividend Yield (%)',
            'Annual Dividend ($)',
            'Payout Ratio (%)',
            'Growth Rate (%)',
            'Safety Score',
            'Category',
            'Added Date'
        ];

        const rows = portfolio.map(stock => [
            stock.ticker,
            stock.name,
            stock.sector,
            stock.dividendYield,
            stock.annualDividend,
            stock.payoutRatio,
            stock.growthRate,
            stock.safetyScore,
            stock.category,
            new Date(stock.addedAt).toLocaleDateString()
        ]);

        // Build CSV string
        const csv = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        return csv;
    }

    // ========================================================================
    // DATABASE MAINTENANCE
    // ========================================================================

    /**
     * Runs all cleanup routines.
     * Call this periodically (e.g., on app startup).
     */
    async function runMaintenance() {
        console.log('[DB] Running maintenance...');
        await cleanupHistory();
        await cleanupTrends();
        console.log('[DB] Maintenance complete');
    }

    /**
     * Gets database storage usage estimate.
     */
    async function getStorageEstimate() {
        if ('storage' in navigator && 'estimate' in navigator.storage) {
            const estimate = await navigator.storage.estimate();
            return {
                used: estimate.usage,
                quota: estimate.quota,
                percentUsed: ((estimate.usage / estimate.quota) * 100).toFixed(2)
            };
        }
        return null;
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    return {
        // Initialization
        init,

        // Portfolio
        addToPortfolio,
        removeFromPortfolio,
        getPortfolio,
        isInPortfolio,
        getPortfolioStats,

        // History
        recordSwipe,
        getSwipedTickers,
        getRecentSwipes,
        removeSwipe,
        clearHistory,
        clearPortfolio,

        // Cache
        cacheStocks,
        getCachedStocks,
        getCachedStock,
        clearStockCache,

        // Trends
        saveTrendSnapshot,
        getTrendData,
        getTickersWithTrends,

        // Settings
        getSetting,
        setSetting,
        getAllSettings,

        // Export
        exportPortfolioCSV,

        // Maintenance
        runMaintenance,
        getStorageEstimate
    };
})();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DividendDB;
}
