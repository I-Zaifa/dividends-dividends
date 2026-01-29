/**
 * ============================================================================
 * DIVIDEND HUNTER - API Client
 * ============================================================================
 * Handles all communication with the backend API.
 * Implements offline-first strategy:
 * 1. Try network first
 * 2. Fall back to IndexedDB cache if offline
 * 3. Update cache when network succeeds
 * 
 * The API is designed to be resilient - the app should work even
 * if the backend is temporarily unavailable.
 */

const DividendAPI = (function() {
    'use strict';

    // ========================================================================
    // CONFIGURATION
    // ========================================================================
    
    // Base URL - set this to your deployed backend
    // For local dev: '/api'
    // For production: 'https://your-backend.onrender.com/api'
    const BASE_URL = window.DIVIDEND_API_URL || '/api';
    
    // Request timeout in milliseconds
    const TIMEOUT = 30000;
    
    // Retry configuration
    const MAX_RETRIES = 2;
    const RETRY_DELAY = 1000;

    // Track online status
    let isOnline = navigator.onLine;

    // Listen for online/offline events
    window.addEventListener('online', () => {
        isOnline = true;
        console.log('[API] Back online');
    });

    window.addEventListener('offline', () => {
        isOnline = false;
        console.log('[API] Gone offline');
    });

    // ========================================================================
    // HTTP HELPERS
    // ========================================================================
    
    /**
     * Makes a fetch request with timeout and error handling.
     */
    async function fetchWithTimeout(url, options = {}) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    /**
     * Makes a GET request with retries.
     */
    async function get(endpoint, params = {}) {
        // Build query string
        const queryString = new URLSearchParams(params).toString();
        const url = queryString ? `${BASE_URL}${endpoint}?${queryString}` : `${BASE_URL}${endpoint}`;

        let lastError;
        
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                const response = await fetchWithTimeout(url);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                return await response.json();
            } catch (error) {
                lastError = error;
                
                // Don't retry if we're offline or it's a client error
                if (!isOnline || (error.name === 'AbortError')) {
                    break;
                }

                if (attempt < MAX_RETRIES) {
                    console.log(`[API] Retry ${attempt + 1}/${MAX_RETRIES} for ${endpoint}`);
                    await sleep(RETRY_DELAY * (attempt + 1));
                }
            }
        }

        throw lastError;
    }

    /**
     * Simple sleep helper for retry delays.
     */
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ========================================================================
    // STOCK DATA ENDPOINTS
    // ========================================================================
    
    /**
     * Fetches dividend stocks with optional filters.
     * Implements offline-first: tries network, falls back to cache.
     * 
     * @param {Object} options - Filter and sort options
     * @param {string} options.category - 'immediate', 'longshot', 'balanced', or 'all'
     * @param {number} options.minYield - Minimum dividend yield percentage
     * @param {number} options.minSafety - Minimum safety score (0-100)
     * @param {string} options.sector - Filter by sector
     * @param {boolean} options.forceRefresh - Force fresh data from API
     * @returns {Promise<Object>} - { stocks: [], total: number, fromCache: boolean }
     */
    async function getStocks(options = {}) {
        const {
            category = 'all',
            minYield = null,
            minSafety = null,
            sector = null,
            forceRefresh = false,
            limit = 100
        } = options;

        // Build API params
        const params = { limit };
        if (category && category !== 'all') params.category = category;
        if (minYield) params.min_yield = minYield;
        if (minSafety) params.min_safety = minSafety;
        if (sector) params.sector = sector;
        if (forceRefresh) params.force_refresh = true;

        try {
            // Try network first
            const data = await get('/stocks', params);
            
            // Cache the results for offline use
            if (data.stocks && data.stocks.length > 0) {
                await DividendDB.cacheStocks(data.stocks);
                
                // Save trend snapshots for each stock
                for (const stock of data.stocks) {
                    await DividendDB.saveTrendSnapshot(stock.ticker, stock);
                }
            }

            return {
                stocks: data.stocks || [],
                total: data.total || 0,
                fetchedAt: data.fetchedAt,
                fromCache: false
            };
        } catch (error) {
            console.warn('[API] Network request failed, trying cache:', error.message);
            
            // Fall back to cache
            const cached = await DividendDB.getCachedStocks({
                category: category !== 'all' ? category : null,
                minYield,
                minSafety,
                checkFreshness: false // Accept stale data when offline
            });

            if (cached && cached.length > 0) {
                return {
                    stocks: cached,
                    total: cached.length,
                    fetchedAt: null,
                    fromCache: true
                };
            }

            // No cache either - propagate the error
            throw new Error('No data available. Please check your connection.');
        }
    }

    /**
     * Fetches detailed data for a single stock.
     */
    async function getStockDetail(ticker) {
        try {
            return await get(`/stock/${ticker}`);
        } catch (error) {
            // Try cache
            const cached = await DividendDB.getCachedStock(ticker);
            if (cached) {
                // Enhance with local trend data
                cached.historicalTrend = await DividendDB.getTrendData(ticker);
                cached.fromCache = true;
                return cached;
            }
            throw error;
        }
    }

    /**
     * Gets the top-ranked dividend stocks.
     * Used for quick "best picks" view.
     */
    async function getTopStocks(count = 10, category = null) {
        const params = { count };
        if (category) params.category = category;

        try {
            const data = await get('/top', params);
            return data.stocks || [];
        } catch (error) {
            // Fall back to cached data sorted by rank
            const cached = await DividendDB.getCachedStocks({
                category,
                checkFreshness: false
            });
            return cached ? cached.slice(0, count) : [];
        }
    }

    /**
     * Fetches trend data for a specific stock.
     */
    async function getTrends(ticker) {
        try {
            return await get(`/trends/${ticker}`);
        } catch (error) {
            // Return local trend data
            const trends = await DividendDB.getTrendData(ticker);
            return {
                ticker,
                trends,
                fromCache: true
            };
        }
    }

    /**
     * Gets list of available sectors for filtering.
     */
    async function getSectors() {
        try {
            const data = await get('/sectors');
            return data.sectors || [];
        } catch (error) {
            // Extract from cached stocks
            const cached = await DividendDB.getCachedStocks({ checkFreshness: false });
            if (cached) {
                const sectors = [...new Set(cached.map(s => s.sector).filter(Boolean))];
                return sectors.sort();
            }
            return [];
        }
    }

    // ========================================================================
    // DATA REFRESH
    // ========================================================================
    
    /**
     * Forces a refresh of all stock data.
     * Use sparingly - the backend will rate-limit yfinance calls.
     */
    async function refreshAllData() {
        console.log('[API] Forcing full data refresh...');
        return await getStocks({ forceRefresh: true });
    }

    /**
     * Checks if we should auto-refresh based on cache age.
     */
    async function shouldRefresh() {
        const lastFetch = await DividendDB.getSetting('lastFetchTime');
        if (!lastFetch) return true;
        
        const hoursSinceLastFetch = (Date.now() - lastFetch) / (1000 * 60 * 60);
        return hoursSinceLastFetch >= 1;
    }

    /**
     * Records the last fetch time.
     */
    async function recordFetchTime() {
        await DividendDB.setSetting('lastFetchTime', Date.now());
    }

    // ========================================================================
    // HEALTH CHECK
    // ========================================================================
    
    /**
     * Checks if the API is reachable.
     */
    async function healthCheck() {
        try {
            const response = await fetchWithTimeout(`${BASE_URL}/`);
            const data = await response.json();
            return data.status === 'ok';
        } catch {
            return false;
        }
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================
    
    return {
        // Data fetching
        getStocks,
        getStockDetail,
        getTopStocks,
        getTrends,
        getSectors,
        
        // Refresh
        refreshAllData,
        shouldRefresh,
        recordFetchTime,
        
        // Status
        healthCheck,
        get isOnline() { return isOnline; }
    };
})();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DividendAPI;
}
