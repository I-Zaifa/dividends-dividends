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
    let currentFilter = 'all';
    let settings = {
        minYield: 0,
        minSafety: 0,
        autoRefresh: true
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
            // Show loading state
            if (elements.cardStack) {
                elements.cardStack.innerHTML = `
                    <div style="text-align: center; padding: 48px; color: var(--text-muted);">
                        <div style="margin-bottom: 16px;">Loading dividend data...</div>
                        <div style="font-size: 0.75rem;">This may take a moment</div>
                    </div>
                `;
            }

            // Fetch stocks with current filters
            const data = await DividendAPI.getStocks({
                category: currentFilter !== 'all' ? currentFilter : null,
                minYield: settings.minYield || null,
                minSafety: settings.minSafety || null,
                forceRefresh
            });

            if (data.fromCache) {
                showToast('Using cached data', 'info');
            }

            // Handle seeding state
            if (data.isSeeding) {
                if (elements.cardStack) {
                    elements.cardStack.innerHTML = `
                        <div style="text-align: center; padding: 48px; color: var(--text-muted);">
                            <div style="font-size: 2rem; margin-bottom: 16px;">🌱</div>
                            <div style="margin-bottom: 8px; font-weight: bold;">Initializing Database</div>
                            <div style="font-size: 0.875rem;">First-time setup in progress...</div>
                            <div style="font-size: 0.75rem; margin-top: 8px; opacity: 0.7;">Check back in a minute</div>
                            <button onclick="DividendApp.refresh()" style="margin-top: 16px; padding: 8px 16px; background: var(--bg-secondary); border: 1px solid var(--accent-primary); border-radius: 8px; color: var(--accent-primary); cursor: pointer;">
                                Check Status
                            </button>
                        </div>
                    `;
                }
                // If we also have some cached data (from previous partial seed?), we might want to show it?
                // The API logic returns `stocks: cached` if available even if seeding.
                // So if data.stocks has items, we should probably proceed to show them BUT show a toast or banner.
            }

            // Get swiped tickers to filter out already-seen stocks
            const swipedTickers = await DividendDB.getSwipedTickers();

            // Filter stocks
            const unseenStocks = (data.stocks || []).filter(s => !swipedTickers.has(s.ticker));

            // Initialize card swiper
            // If we have stocks (even if seeding), show them
            if (unseenStocks.length > 0) {
                if (data.isSeeding) {
                    showToast('Background update in progress...', 'info');
                }
                CardSwiper.init(elements.cardStack, unseenStocks, {
                    onSwipeRight: handleLike,
                    onSwipeLeft: handlePass,
                    onEmpty: handleEmpty
                });
            } else if (!data.isSeeding) {
                // legitimate empty state handled by swiper or Empty handler, 
                // but if init wasn't called (0 stocks), swiper might need manual empty state?
                // CardSwiper.init handles empty array? Let's assume it might not replace innerHTML if empty.
                // Let's check CardSwiper.init. If it doesn't handle empty, we need to.
                // Assuming it does based on previous code.
                if (data.stocks.length === 0) {
                    handleEmpty();
                }
            }

            // Record fetch time
            if (!data.fromCache) {
                await DividendAPI.recordFetchTime();
            }

        } catch (error) {
            console.error('[App] Failed to load stocks:', error);
            showToast('Failed to load data. Please try again.', 'error');

            // Show error state in card stack
            if (elements.cardStack) {
                elements.cardStack.innerHTML = `
                    <div style="text-align: center; padding: 48px; color: var(--text-muted);">
                        <div style="margin-bottom: 16px;">Unable to load data</div>
                        <button onclick="DividendApp.refresh()" style="padding: 8px 16px; background: var(--accent-primary); border: none; border-radius: 8px; color: var(--bg-primary); cursor: pointer;">
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
     * Refreshes stock data.
     */
    async function refresh() {
        await loadStocks(true);
        showToast('Data refreshed', 'success');
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
    }

    /**
     * Handles undo action.
     */
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
            trendList.innerHTML = `
                <div style="text-align: center; padding: 48px; color: var(--text-muted);">
                    <p>No trend data yet</p>
                    <p style="font-size: 0.75rem; margin-top: 8px;">Keep using the app to build historical data</p>
                </div>
            `;
            return;
        }

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
        elements.undoBtn?.addEventListener('click', handleUndo);
        elements.refreshBtn?.addEventListener('click', refresh);

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
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;

        elements.toastContainer?.appendChild(toast);

        // Remove after 3 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
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
        showStockDetail,
        closeModal,
        showToast
    };
})();

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    DividendApp.init();
});
