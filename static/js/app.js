/**
 * ============================================================================
 * DIVIDEND HUNTER - Main Application
 * ============================================================================
 * The orchestration layer that ties everything together.
 * 
 * Responsibilities:
 * - App initialization and lifecycle
 * - View navigation (discover, portfolio, trends, settings)
 * - Filter management
 * - Settings persistence
 * - Toast notifications
 * - Offline handling
 * 
 * This is the "glue" code that makes all the pieces work together.
 */

const DividendApp = (function () {
    'use strict';

    // ========================================================================
    // STATE
    // ========================================================================

    let currentView = 'discover';
    let currentFilter = 'long_gamma';

    let settings = {
        minYield: 0,
        minSafety: 0,
        autoRefresh: false // Default to false per user request
    };
    let isLoading = false;
    let refreshInterval = null;

    // ========================================================================
    // DOM REFERENCES
    // ========================================================================

    const elements = {};

    function cacheElements() {
        elements.appLoader = document.getElementById('appLoader');
        elements.offlineBanner = document.getElementById('offlineBanner');
        elements.cardStack = document.getElementById('cardStack');
        elements.filterBar = document.getElementById('filterBar');
        elements.toastContainer = document.getElementById('toastContainer');
        elements.updateDataBtn = document.getElementById('updateDataBtn'); // New button logic

        // Views
        elements.discoverView = document.getElementById('discoverView');
        elements.portfolioView = document.getElementById('portfolioView');
        elements.trendsView = document.getElementById('trendsView');
        elements.settingsView = document.getElementById('settingsView');

        // Portfolio elements
        elements.portfolioList = document.getElementById('portfolioList');
        elements.portfolioEmpty = document.getElementById('portfolioEmpty');
        elements.portfolioCount = document.getElementById('portfolioCount');
        elements.avgYield = document.getElementById('avgYield');
        elements.portfolioBadge = document.getElementById('portfolioBadge');

        // Buttons
        elements.refreshBtn = document.getElementById('refreshBtn');
        elements.passBtn = document.getElementById('passBtn');
        elements.likeBtn = document.getElementById('likeBtn');
        elements.undoBtn = document.getElementById('undoBtn');

        // Settings
        elements.minYieldSetting = document.getElementById('minYieldSetting');
        elements.minSafetySetting = document.getElementById('minSafetySetting');
        elements.autoRefreshSetting = document.getElementById('autoRefreshSetting');
        elements.clearHistoryBtn = document.getElementById('clearHistoryBtn');
        elements.clearPortfolioBtn = document.getElementById('clearPortfolioBtn'); // New button
        elements.exportBtn = document.getElementById('exportBtn');

        // Modal
        elements.stockModal = document.getElementById('stockModal');
        elements.modalClose = document.getElementById('modalClose');
        elements.modalTitle = document.getElementById('modalTitle');
        elements.modalBody = document.getElementById('modalBody');
    }

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    /**
     * Main initialization function.
     * Call this when the DOM is ready.
     */
    async function init() {
        console.log('[App] Initializing Dividend Hunter...');

        // Cache DOM references
        cacheElements();

        // Initialize IndexedDB
        try {
            await DividendDB.init();
            await DividendDB.runMaintenance();
        } catch (error) {
            console.error('[App] Database init failed:', error);
            showToast('Database error. Some features may not work.', 'error');
        }

        // Load saved settings
        await loadSettings();

        // Set up event listeners
        setupEventListeners();

        // Check online status
        updateOnlineStatus();

        // Load initial data
        await loadStocks();

        // Update portfolio badge
        await updatePortfolioBadge();

        // Hide loader
        hideLoader();

        // Set up auto-refresh if enabled
        if (settings.autoRefresh) {
            startAutoRefresh();
        }

        console.log('[App] Initialization complete');
    }

    /**
     * Hides the loading screen.
     */
    function hideLoader() {
        if (elements.appLoader) {
            // Reduced to 800ms for better responsiveness while keeping some "style"
            setTimeout(() => {
                elements.appLoader.classList.add('hidden');
                setTimeout(() => {
                    elements.appLoader.style.display = 'none';
                }, 300);
            }, 800);
        }
    }

    // ========================================================================
    // DATA LOADING
    // ========================================================================

    /**
     * Loads stock data and initializes the card swiper.
     */
    async function loadStocks(forceRefresh = false) {
        if (isLoading) return;
        isLoading = true;

        try {
            // Show loading state ONLY if we don't have cards already (avoid flickering on refresh)
            if (!elements.cardStack.children.length || forceRefresh) {
                elements.cardStack.innerHTML = `
                    <div style="text-align: center; padding: 48px; color: var(--text-muted);">
                        <div class="loader-logo" style="width: 48px; height: 48px; margin: 0 auto 16px; background: var(--accent-primary); border-radius: 50%;"></div>
                        <div style="margin-bottom: 16px; font-family: var(--font-display);">Looking for dividends...</div>
                        <div style="font-size: 0.75rem;">Crunching the numbers</div>
                    </div>
                `;
            }

            // Fetch stocks with current filters
            const data = await DividendAPI.getStocks({
                category: currentFilter !== 'all' ? currentFilter : null,
                minYield: settings.minYield || null,
                minSafety: settings.minSafety || null,
                forceRefresh: forceRefresh
            });

            if (data.fromCache && forceRefresh) {
                // If we asked for fresh data but got cache, it means backend didn't update yet
                // or we are offline.
                showToast('Using cached data', 'info');
            }

            // Get swiped tickers to filter out already-seen stocks
            const swipedTickers = await DividendDB.getSwipedTickers();

            // Filter stocks
            const unseenStocks = (data.stocks || []).filter(s => !swipedTickers.has(s.ticker));

            // CRITICAL FIX: Even if unseenStocks is empty, we must STOP loading
            // and show the "Caught Up" state if valid data existed.

            if (unseenStocks.length > 0) {
                // We have new cards to show
                if (data.isSeeding) {
                    showToast('Background update in progress...', 'info');
                }

                // Clear loader and init swiper
                CardSwiper.init(elements.cardStack, unseenStocks, {
                    onSwipeRight: handleLike,
                    onSwipeLeft: handlePass,
                    onEmpty: handleEmpty
                });
            } else {
                // Validation: Did we get *any* stocks from backend?
                if (data.stocks && data.stocks.length > 0) {
                    // Valid data, but user has seen it all (or filters hid it)
                    // Explicitly handle "All Caught Up" immediately
                    handleEmpty();
                } else {
                    // Truly empty data (rare, or first run failed)
                    if (data.status === 'needs_initialization' || data.isSeeding) {
                        // Keep polling or waiting? 
                        // For now, allow retry.
                        elements.cardStack.innerHTML = `
                            <div style="text-align: center; padding: 48px; color: var(--text-muted);">
                                <div style="margin-bottom: 16px;">Warming up...</div>
                                <div style="font-size: 0.75rem; margin-bottom: 12px;">The backend is fetching fresh data.</div>
                                <div style="font-size: 0.75rem;">Please wait a moment.</div>
                            </div>
                        `;
                        // Auto-retry in 3s if seeding
                        if (data.isSeeding) {
                            setTimeout(() => loadStocks(false), 3000);
                        }
                    } else {
                        // Genuine error or empty DB
                        elements.cardStack.innerHTML = `
                            <div style="text-align: center; padding: 48px; color: var(--text-muted);">
                                <div style="margin-bottom: 16px;">No stocks found</div>
                                <button onclick="DividendApp.refresh(true)" style="padding: 8px 16px; background: var(--accent-primary); border: none; border-radius: 8px; color: var(--bg-primary); cursor: pointer;">
                                    Retry
                                </button>
                            </div>
                        `;
                    }
                }
            }

            // Record fetch time if new
            if (!data.fromCache) {
                await DividendAPI.recordFetchTime();
            }

            // Check freshness logic
            checkDataFreshness(data.fetchedAt);

        } catch (error) {
            console.error('[App] Failed to load stocks:', error);
            showToast('Failed to load data', 'error');

            if (elements.cardStack) {
                elements.cardStack.innerHTML = `
                    <div style="text-align: center; padding: 48px; color: var(--text-muted);">
                        <div style="margin-bottom: 16px;">Unable to load data</div>
                        <button onclick="DividendApp.refresh(true)" style="padding: 8px 16px; background: var(--accent-primary); border: none; border-radius: 8px; color: var(--bg-primary); cursor: pointer;">
                            Try Again
                        </button>
                    </div>
                `;
            }
        } finally {
            isLoading = false;
        }
    }

    /**
     * Checks data age and handles the update button visibility.
     */
    function checkDataFreshness(fetchedAt) {
        if (!fetchedAt) {
            if (elements.updateDataBtn) elements.updateDataBtn.style.display = 'flex';
            return;
        }

        const fetchDate = new Date(fetchedAt);
        const now = new Date();
        const diffDays = (now - fetchDate) / (1000 * 60 * 60 * 24);

        if (elements.updateDataBtn) {
            // STRICT RULE: Only show update button if data is older than 7 days
            if (diffDays > 7) {
                elements.updateDataBtn.style.display = 'flex';
                elements.updateDataBtn.title = `Data is ${Math.floor(diffDays)} days old`;
                elements.updateDataBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/>
                    </svg>
                    <span>Update Available</span>
                `;
            } else {
                // Hide it completely if fresh
                elements.updateDataBtn.style.display = 'none';
            }
        }
    }

    /**
     * Refreshes stock data.
     * @param {boolean} force - If true, bypasses the 7-day check.
     */
    async function refresh(force = false) {
        // 1. Check if we really need to refresh
        const shouldRefresh = await DividendAPI.shouldRefresh(); // This will now check 7 days in api.js

        // If data is fresh (and we aren't forced), just show the happy toast
        if (!shouldRefresh && !force) {
            showToast('Data is fresh', 'success');
            return;
        }

        // 2. Proceed with actual refresh
        if (elements.updateDataBtn) {
            elements.updateDataBtn.style.display = 'flex'; // Temporarily show to show loading state
            elements.updateDataBtn.disabled = true;
            elements.updateDataBtn.innerHTML = `
                <svg class="loader-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                </svg>
                <span>Updating...</span>
            `;
        }

        // Pass force=true to API to ensure backend actually works
        await loadStocks(true);

        if (elements.updateDataBtn) {
            elements.updateDataBtn.disabled = false;
            // After update, check freshness again to decide visibility
            // (Likely hides it since data is now new)
            // But we reload stocks anyway which calls checkDataFreshness
        }

        showToast('Data updated', 'success');
    }

    // ========================================================================
    // SWIPE HANDLERS
    // ========================================================================

    /**
     * Called when user swipes right (likes/saves a stock).
     */
    async function handleLike(stock) {
        console.log(`[App] Liked: ${stock.ticker}`);

        // Save to portfolio
        await DividendDB.addToPortfolio(stock);

        // Record in swipe history
        await DividendDB.recordSwipe(stock.ticker, 'like');

        // Update badge
        await updatePortfolioBadge();

        showToast(`Added ${stock.ticker} to portfolio`, 'success');
    }

    /**
     * Called when user swipes left (passes on a stock).
     */
    async function handlePass(stock) {
        console.log(`[App] Passed: ${stock.ticker}`);

        // Record in swipe history (so we don't show it again)
        await DividendDB.recordSwipe(stock.ticker, 'pass');
    }

    /**
     * Called when no more cards to show.
     */
    function handleEmpty() {
        console.log('[App] No more stocks to review');

        // Show a nice "caught up" state
        if (elements.cardStack) {
            elements.cardStack.innerHTML = `
                <div style="text-align: center; padding: 48px; color: var(--text-muted); animation: fadeIn 0.5s ease;">
                    <div style="margin-bottom: 24px; opacity: 0.5;">
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                            <polyline points="22 4 12 14.01 9 11.01"></polyline>
                        </svg>
                    </div>
                    <div style="font-family: var(--font-display); font-size: 1.25rem; font-weight: 700; color: var(--text-primary); margin-bottom: 12px;">All Caught Up!</div>
                    <p style="font-size: 0.875rem; line-height: 1.5; max-width: 280px; margin: 0 auto;">
                        You've viewed all current opportunities. <br>
                        Check back later or adjust your filters.
                    </p>
                    <div style="margin-top: 32px; display: flex; justify-content: center; gap: 12px;">
                        <button onclick="DividendApp.refresh(true)" style="padding: 10px 20px; background: var(--bg-card); border: 1px solid var(--bg-card-hover); border-radius: 99px; color: var(--text-primary); cursor: pointer; font-size: 0.875rem; font-weight: 500;">
                            Force Refresh
                        </button>
                        <button onclick="DividendApp.clearHistory()" style="padding: 10px 20px; background: transparent; border: 1px solid var(--text-muted); border-radius: 99px; color: var(--text-secondary); cursor: pointer; font-size: 0.875rem;">
                            Reset History
                        </button>
                    </div>
                </div>
            `;
        }
    }
    async function handleUndo() {
        const undone = CardSwiper.undo();

        if (undone) {
            // Remove from history
            await DividendDB.removeSwipe(undone.stock.ticker);

            // If it was a like, remove from portfolio too
            if (undone.direction === 'right') {
                await DividendDB.removeFromPortfolio(undone.stock.ticker);
                await updatePortfolioBadge();
            }

            showToast(`Undid ${undone.stock.ticker}`, 'info');
        }
    }

    /**
     * Handles randomize action.
     */
    function handleRandomize() {
        CardSwiper.randomize();
        showToast('Deck shuffled!', 'success');
    }

    // ========================================================================
    // VIEW NAVIGATION
    // ========================================================================

    /**
     * Switches to a different view.
     */
    function switchView(viewName) {
        if (viewName === currentView) return;

        // Update view visibility
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(`${viewName}View`)?.classList.add('active');

        // Update nav items
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelector(`.nav-item[data-view="${viewName}"]`)?.classList.add('active');

        // Show/hide filter bar (only on discover)
        if (elements.filterBar) {
            elements.filterBar.style.display = viewName === 'discover' ? 'flex' : 'none';
        }

        currentView = viewName;

        // Load view-specific data
        if (viewName === 'portfolio') {
            renderPortfolio();
        } else if (viewName === 'trends') {
            renderTrends();
        }
    }

    // ========================================================================
    // PORTFOLIO VIEW
    // ========================================================================

    /**
     * Renders the portfolio view.
     */
    async function renderPortfolio() {
        const portfolio = await DividendDB.getPortfolio();
        const stats = await DividendDB.getPortfolioStats();

        // Update stats
        elements.portfolioCount.textContent = stats.count;
        elements.avgYield.textContent = stats.avgYield + '%';

        // Show empty state or list
        if (portfolio.length === 0) {
            elements.portfolioList.style.display = 'none';
            elements.portfolioEmpty.style.display = 'block';
        } else {
            elements.portfolioEmpty.style.display = 'none';
            elements.portfolioList.style.display = 'flex';

            // Render portfolio items
            elements.portfolioList.innerHTML = portfolio.map(stock => `
        <div class="portfolio-item" data-ticker="${stock.ticker}">
            <span class="portfolio-item-ticker">${stock.ticker}</span>
            <span class="portfolio-item-name">${stock.name || stock.ticker}</span>
            <span class="portfolio-item-yield">${stock.dividendYield.toFixed(2)}%</span>
            <button class="portfolio-item-remove" onclick="DividendApp.removeFromPortfolio('${stock.ticker}')" title="Remove">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
        `).join('');
        }
    }

    /**
     * Removes a stock from the portfolio.
     */
    async function removeFromPortfolio(ticker) {
        await DividendDB.removeFromPortfolio(ticker);
        await updatePortfolioBadge();
        renderPortfolio();
        showToast(`Removed ${ticker}`, 'info');
    }

    /**
     * Updates the portfolio badge count.
     */
    async function updatePortfolioBadge() {
        const stats = await DividendDB.getPortfolioStats();

        if (stats.count > 0) {
            elements.portfolioBadge.textContent = stats.count;
            elements.portfolioBadge.style.display = 'flex';
        } else {
            elements.portfolioBadge.style.display = 'none';
        }
    }

    // ========================================================================
    // TRENDS VIEW
    // ========================================================================

    /**
     * Renders the trends view.
     */
    async function renderTrends() {
        const trendList = document.getElementById('trendList');
        const tickers = await DividendDB.getTickersWithTrends();

        if (tickers.length === 0) {
            // Hide chart container if no data
            const chartContainer = document.querySelector('.trend-chart-container');
            if (chartContainer) chartContainer.style.display = 'none';

            trendList.innerHTML = `
                <div style="text-align: center; padding: 48px; color: var(--text-muted);">
                    <p>No trend data yet</p>
                    <p style="font-size: 0.75rem; margin-top: 8px;">Keep using the app to build historical data</p>
                </div>
            `;
            return;
        }

        // Show chart container
        const chartContainer = document.querySelector('.trend-chart-container');
        if (chartContainer) chartContainer.style.display = 'block';

        // Get portfolio tickers for priority
        const portfolio = await DividendDB.getPortfolio();
        const portfolioTickers = new Set(portfolio.map(p => p.ticker));

        // Sort: portfolio stocks first
        const sortedTickers = tickers.sort((a, b) => {
            const aInPortfolio = portfolioTickers.has(a);
            const bInPortfolio = portfolioTickers.has(b);
            if (aInPortfolio && !bInPortfolio) return -1;
            if (!aInPortfolio && bInPortfolio) return 1;
            return a.localeCompare(b);
        });

        // ----------------------------------------------------
        // Chart.js Visualization
        // ----------------------------------------------------

        // Destroy existing chart if it exists
        if (window.trendChartInstance) {
            window.trendChartInstance.destroy();
            window.trendChartInstance = null;
        }

        const canvas = document.getElementById('trendChart');
        if (typeof Chart !== 'undefined' && canvas) {
            // Prepare datasets for top 5 stocks
            const topTickers = sortedTickers.slice(0, 5);
            const datasets = [];
            const colors = ['#d4a853', '#2ecc71', '#e74c3c', '#3498db', '#f39c12'];

            // Get all unique dates for labels
            let allDates = new Set();
            let allDatasets = [];

            for (let i = 0; i < topTickers.length; i++) {
                const ticker = topTickers[i];
                // Try to get full history from stock object if we can find it
                const stock = (await DividendAPI.getStockDetail(ticker)) || {};
                let dataPoints = [];

                if (stock.dividendHistory && stock.dividendHistory.length > 0) {
                    // Use full history (Quarterly payments)
                    // limit to last 5 years for readability
                    dataPoints = stock.dividendHistory
                        .sort((a, b) => new Date(a.date) - new Date(b.date))
                        .map(t => ({ x: t.date, y: t.amount })); // Use amount for history, not yield
                } else {
                    // Fallback to trend snapshots (Yield)
                    const trends = await DividendDB.getTrendData(ticker);
                    dataPoints = trends.map(t => ({ x: t.date, y: t.yield }));
                }

                if (dataPoints.length > 0) {
                    dataPoints.forEach(p => allDates.add(p.x));

                    allDatasets.push({
                        label: ticker,
                        data: dataPoints,
                        borderColor: colors[i % colors.length],
                        backgroundColor: colors[i % colors.length],
                        borderWidth: 2,
                        tension: 0.1,
                        pointRadius: 3
                    });
                }
            }
            // Assign the populated datasets
            const finalDatasets = allDatasets;

            const sortedDates = Array.from(allDates).sort();

            window.trendChartInstance = new Chart(canvas, {
                type: 'line',
                data: {
                    labels: sortedDates,
                    datasets: finalDatasets
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'index',
                        intersect: false,
                    },
                    plugins: {
                        legend: {
                            labels: { color: '#a0a0b0' }
                        },
                        tooltip: {
                            mode: 'index',
                            intersect: false
                        }
                    },
                    scales: {
                        x: {
                            ticks: { color: '#606070' },
                            grid: { color: 'rgba(255, 255, 255, 0.05)' }
                        },
                        y: {
                            ticks: {
                                color: '#606070',
                                callback: function (value) { return value + '%' }
                            },
                            grid: { color: 'rgba(255, 255, 255, 0.05)' },
                            title: {
                                display: true,
                                text: 'Dividend Yield',
                                color: '#606070'
                            }
                        }
                    }
                }
            });
        }

        // ----------------------------------------------------
        // List Rendering
        // ----------------------------------------------------

        // Render trend cards
        let html = '<div style="display: flex; flex-direction: column; gap: 12px;">';

        for (const ticker of sortedTickers.slice(0, 20)) {
            const trends = await DividendDB.getTrendData(ticker);
            if (trends.length < 2) continue;

            const latest = trends[trends.length - 1];
            const oldest = trends[0];
            const yieldChange = latest.yield - oldest.yield;
            const changeClass = yieldChange >= 0 ? 'positive' : 'negative';
            const inPortfolio = portfolioTickers.has(ticker);

            html += `
            <div class="portfolio-item" style="cursor: pointer;" onclick="DividendApp.showStockDetail('${ticker}')">
                ${inPortfolio ? '<span style="color: var(--accent-primary); margin-right: 8px;">★</span>' : ''}
                <span class="portfolio-item-ticker">${ticker}</span>
                <span class="portfolio-item-name">${trends.length} data points</span>
                <span class="portfolio-item-yield ${changeClass}">${yieldChange >= 0 ? '+' : ''}${yieldChange.toFixed(2)}%</span>
            </div>
            `;
        }

        html += '</div>';
        trendList.innerHTML = html;
    }

    // ========================================================================
    // STOCK DETAIL MODAL
    // ========================================================================

    /**
     * Shows the stock detail modal.
     */
    async function showStockDetail(ticker) {
        try {
            const stock = await DividendAPI.getStockDetail(ticker);

            elements.modalTitle.textContent = `${stock.ticker} - ${stock.name}`;

            elements.modalBody.innerHTML = `
        <div style="display: grid; gap: 16px;">
            <!-- Price and yield -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                <div class="stat-card">
                    <div class="stat-value">$${stock.price?.toFixed(2) || 'N/A'}</div>
                    <div class="stat-label">Current Price</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" style="color: var(--positive);">${stock.dividendYield?.toFixed(2)}%</div>
                    <div class="stat-label">Dividend Yield</div>
                </div>
            </div>

            <!-- Key metrics -->
            <div style="background: var(--bg-card); border-radius: 12px; padding: 16px;">
                <h4 style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 12px;">Dividend Details</h4>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div>
                        <div style="color: var(--text-muted); font-size: 0.75rem;">Annual Dividend</div>
                        <div style="font-family: var(--font-display); font-weight: 700;">$${stock.annualDividend?.toFixed(2) || 'N/A'}</div>
                    </div>
                    <div>
                        <div style="color: var(--text-muted); font-size: 0.75rem;">Payout Ratio</div>
                        <div style="font-family: var(--font-display); font-weight: 700;">${stock.payoutRatio?.toFixed(0)}%</div>
                    </div>
                    <div>
                        <div style="color: var(--text-muted); font-size: 0.75rem;">5Y Growth Rate</div>
                        <div style="font-family: var(--font-display); font-weight: 700; color: ${stock.growthRate >= 0 ? 'var(--positive)' : 'var(--negative)'};">${stock.growthRate >= 0 ? '+' : ''}${stock.growthRate?.toFixed(1)}%</div>
                    </div>
                    <div>
                        <div style="color: var(--text-muted); font-size: 0.75rem;">Consecutive Years</div>
                        <div style="font-family: var(--font-display); font-weight: 700;">${stock.consecutiveYears || 0} years</div>
                    </div>
                    <div>
                        <div style="color: var(--text-muted); font-size: 0.75rem;">Payment Frequency</div>
                        <div style="font-family: var(--font-display); font-weight: 700;">${stock.paymentFrequency || 'Unknown'}</div>
                    </div>
                    <div>
                        <div style="color: var(--text-muted); font-size: 0.75rem;">Ex-Dividend Date</div>
                        <div style="font-family: var(--font-display); font-weight: 700;">${stock.exDividendDate || 'N/A'}</div>
                    </div>
                </div>
            </div>

            <!-- Safety score -->
            <div style="background: var(--bg-card); border-radius: 12px; padding: 16px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span style="color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase;">Safety Score</span>
                    <span style="font-family: var(--font-display); font-weight: 700;">${stock.safetyScore}/100</span>
                </div>
                <div style="height: 8px; background: var(--bg-secondary); border-radius: 999px; overflow: hidden;">
                    <div style="height: 100%; width: ${stock.safetyScore}%; background: ${getSafetyColor(stock.safetyScore)}; border-radius: 999px;"></div>
                </div>
            </div>

            <!-- Company info -->
            <div style="background: var(--bg-card); border-radius: 12px; padding: 16px;">
                <h4 style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 12px;">Company Info</h4>
                <div style="display: grid; gap: 8px;">
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: var(--text-muted);">Sector</span>
                        <span>${stock.sector || 'Unknown'}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: var(--text-muted);">Industry</span>
                        <span>${stock.industry || 'Unknown'}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: var(--text-muted);">Market Cap</span>
                        <span>${formatMarketCap(stock.marketCap)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: var(--text-muted);">P/E Ratio</span>
                        <span>${stock.peRatio?.toFixed(2) || 'N/A'}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: var(--text-muted);">52W Range</span>
                        <span>$${stock.fiftyTwoWeekLow?.toFixed(0)} - $${stock.fiftyTwoWeekHigh?.toFixed(0)}</span>
                    </div>
                </div>
            </div>
        </div>
        `;

            elements.stockModal.classList.add('visible');
        } catch (error) {
            console.error('[App] Failed to load stock detail:', error);
            showToast('Failed to load stock details', 'error');
        }
    }

    /**
     * Closes the stock detail modal.
     */
    function closeModal() {
        elements.stockModal.classList.remove('visible');
    }

    // ========================================================================
    // FILTERS
    // ========================================================================

    /**
     * Sets the category filter and reloads stocks.
     */
    async function setFilter(filter) {
        if (filter === currentFilter) return;

        currentFilter = filter;

        // Update active pill
        document.querySelectorAll('.filter-pill').forEach(p => {
            p.classList.toggle('active', p.dataset.filter === filter);
        });

        // Reload stocks with new filter
        await loadStocks();
    }

    // ========================================================================
    // SETTINGS
    // ========================================================================

    /**
     * Loads settings from IndexedDB.
     */
    async function loadSettings() {
        const saved = await DividendDB.getAllSettings();
        settings = { ...settings, ...saved };

        // Update UI
        if (elements.minYieldSetting) {
            elements.minYieldSetting.value = settings.minYield || 0;
        }
        if (elements.minSafetySetting) {
            elements.minSafetySetting.value = settings.minSafety || 0;
        }
        if (elements.autoRefreshSetting) {
            elements.autoRefreshSetting.checked = settings.autoRefresh !== false;
        }
    }

    /**
     * Saves a setting.
     */
    async function saveSetting(key, value) {
        settings[key] = value;
        await DividendDB.setSetting(key, value);

        // Handle auto-refresh toggle
        if (key === 'autoRefresh') {
            if (value) {
                startAutoRefresh();
            } else {
                stopAutoRefresh();
            }
        }

        // Reload stocks if filter settings changed
        if (key === 'minYield' || key === 'minSafety') {
            await loadStocks();
        }
    }

    /**
     * Starts auto-refresh interval.
     */
    function startAutoRefresh() {
        if (refreshInterval) return;

        // Check every hour
        refreshInterval = setInterval(async () => {
            if (await DividendAPI.shouldRefresh()) {
                console.log('[App] Auto-refreshing data...');
                await loadStocks(true);
            }
        }, 60 * 60 * 1000); // 1 hour

        console.log('[App] Auto-refresh enabled');
    }

    /**
     * Stops auto-refresh interval.
     */
    function stopAutoRefresh() {
        if (refreshInterval) {
            clearInterval(refreshInterval);
            refreshInterval = null;
            console.log('[App] Auto-refresh disabled');
        }
    }

    /**
     * Clears swipe history.
     */
    async function clearHistory() {
        if (confirm('Clear all swipe history? You will see passed stocks again.')) {
            await DividendDB.clearHistory();
            await loadStocks();
            showToast('History cleared', 'success');
        }
    }

    /**
     * Clears portfolio.
     */
    async function clearPortfolio() {
        if (confirm('Clear your entire portfolio? This cannot be undone.')) {
            await DividendDB.clearPortfolio();
            await updatePortfolioBadge();
            if (currentView === 'portfolio') {
                await renderPortfolio();
            }
            showToast('Portfolio cleared', 'success');
        }
    }

    /**
     * Exports portfolio to CSV.
     */
    async function exportPortfolio() {
        const csv = await DividendDB.exportPortfolioCSV();

        if (!csv) {
            showToast('Portfolio is empty', 'error');
            return;
        }

        // Create download
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dividend-portfolio-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);

        showToast('Portfolio exported', 'success');
    }

    // ========================================================================
    // EVENT LISTENERS
    // ========================================================================

    /**
     * Sets up all event listeners.
     */
    function setupEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                switchView(item.dataset.view);
            });
        });

        // Filter pills
        document.querySelectorAll('.filter-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                setFilter(pill.dataset.filter);
            });
        });

        // Action buttons
        elements.passBtn?.addEventListener('click', () => CardSwiper.swipeLeft());
        elements.likeBtn?.addEventListener('click', () => CardSwiper.swipeRight());

        // Randomize (Middle Button)
        if (elements.undoBtn) {
            // Update icon to Shuffle
            elements.undoBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 3 21 3 21 8"></polyline><line x1="4" y1="20" x2="21" y2="3"></line><polyline points="21 16 21 21 16 21"></polyline><line x1="15" y1="15" x2="21" y2="21"></line><line x1="4" y1="4" x2="9" y2="9"></line></svg>`;
            elements.undoBtn.title = "Randomize Stack";
            elements.undoBtn.addEventListener('click', handleRandomize);
        }

        // Bind both refresh buttons
        elements.refreshBtn?.addEventListener('click', refresh);
        elements.updateDataBtn?.addEventListener('click', refresh);

        // Settings
        elements.minYieldSetting?.addEventListener('change', (e) => {
            saveSetting('minYield', parseFloat(e.target.value));
        });
        elements.minSafetySetting?.addEventListener('change', (e) => {
            saveSetting('minSafety', parseInt(e.target.value));
        });
        elements.autoRefreshSetting?.addEventListener('change', (e) => {
            saveSetting('autoRefresh', e.target.checked);
        });
        elements.clearHistoryBtn?.addEventListener('click', clearHistory);
        elements.clearPortfolioBtn?.addEventListener('click', clearPortfolio); // New listener
        elements.exportBtn?.addEventListener('click', exportPortfolio);

        // Modal
        elements.modalClose?.addEventListener('click', closeModal);
        elements.stockModal?.addEventListener('click', (e) => {
            if (e.target === elements.stockModal) {
                closeModal();
            }
        });

        // Online/offline events
        window.addEventListener('online', () => updateOnlineStatus());
        window.addEventListener('offline', () => updateOnlineStatus());

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (currentView !== 'discover') return;

            if (e.key === 'ArrowLeft') {
                CardSwiper.swipeLeft();
            } else if (e.key === 'ArrowRight') {
                CardSwiper.swipeRight();
            } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
                handleUndo();
            }
        });
    }

    // ========================================================================
    // OFFLINE HANDLING
    // ========================================================================

    /**
     * Updates UI based on online status.
     */
    function updateOnlineStatus() {
        if (navigator.onLine) {
            elements.offlineBanner?.classList.remove('visible');
        } else {
            elements.offlineBanner?.classList.add('visible');
        }
    }

    // ========================================================================
    // UTILITIES
    // ========================================================================

    /**
     * Shows a toast notification.
     */
    function showToast(message, type = 'info') {
        // Prevent stacking: Remove existing toasts
        if (elements.toastContainer) {
            elements.toastContainer.innerHTML = '';
        }

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        // Icons mapping
        let icon = '';
        if (type === 'success') {
            icon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        } else if (type === 'error') {
            icon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
        } else {
            icon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
        }

        toast.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
            ${icon}
            <span>${message}</span>
        </div>
        `;

        elements.toastContainer?.appendChild(toast);

        // Animate in
        requestAnimationFrame(() => {
            toast.classList.add('visible');
        });

        // Remove after 3s
        setTimeout(() => {
            if (toast.parentElement) {
                toast.classList.remove('visible');
                setTimeout(() => {
                    toast.remove();
                }, 300);
            }
        }, 3000);
    }

    /**
     * Gets color for safety score.
     */
    function getSafetyColor(score) {
        if (score >= 70) return '#2ecc71';
        if (score >= 50) return '#f39c12';
        if (score >= 30) return '#e67e22';
        return '#e74c3c';
    }

    /**
     * Formats market cap for display.
     */
    function formatMarketCap(value) {
        if (!value) return 'N/A';
        if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
        if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
        if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
        return `$${value.toLocaleString()}`;
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    return {
        init,
        refresh,
        switchView,
        setFilter,
        removeFromPortfolio,
        clearHistory,
        clearPortfolio,
        showStockDetail,
        closeModal,
        showToast
    };
})();

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    DividendApp.init();
});
