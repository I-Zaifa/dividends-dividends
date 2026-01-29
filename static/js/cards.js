/**
 * ============================================================================
 * DIVIDEND HUNTER - Card Swipe Manager
 * ============================================================================
 * Handles the tinder-style card swiping interface.
 * 
 * Features:
 * - Touch gesture recognition (drag to swipe)
 * - Mouse drag support for desktop
 * - Button-based swipe alternatives
 * - Card stack visual effect
 * - Swipe animations
 * - Undo last swipe
 * 
 * Design philosophy:
 * The cards should feel physical - they respond to your movements
 * and have satisfying animations when dismissed.
 */

const CardSwiper = (function() {
    'use strict';

    // ========================================================================
    // CONFIGURATION
    // ========================================================================
    
    const CONFIG = {
        // How far user must drag (as % of card width) to trigger swipe
        SWIPE_THRESHOLD: 0.25,
        
        // Rotation factor based on horizontal drag
        ROTATION_FACTOR: 0.08,
        
        // Animation duration in ms
        ANIMATION_DURATION: 300,
        
        // How many cards to show in the stack
        STACK_SIZE: 3,
        
        // Velocity threshold for "fling" gestures
        VELOCITY_THRESHOLD: 0.5
    };

    // ========================================================================
    // STATE
    // ========================================================================
    
    let stocks = [];              // Current stock queue
    let currentIndex = 0;         // Index of top card in queue
    let swipeHistory = [];        // For undo functionality
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let currentY = 0;
    let startTime = 0;

    // DOM references
    let cardStack = null;
    let currentCard = null;

    // Callbacks
    let onSwipeLeft = null;       // Called when user passes
    let onSwipeRight = null;      // Called when user likes
    let onEmpty = null;           // Called when no more cards

    // ========================================================================
    // INITIALIZATION
    // ========================================================================
    
    /**
     * Initializes the card swiper with stock data.
     * 
     * @param {HTMLElement} container - The card stack container element
     * @param {Array} stockData - Array of stock objects to display
     * @param {Object} callbacks - Event callbacks
     */
    function init(container, stockData, callbacks = {}) {
        cardStack = container;
        stocks = [...stockData]; // Clone to avoid mutation
        currentIndex = 0;
        swipeHistory = [];

        onSwipeLeft = callbacks.onSwipeLeft || (() => {});
        onSwipeRight = callbacks.onSwipeRight || (() => {});
        onEmpty = callbacks.onEmpty || (() => {});

        render();
    }

    /**
     * Updates the stock data (e.g., when filters change).
     */
    function updateStocks(newStocks) {
        stocks = [...newStocks];
        currentIndex = 0;
        swipeHistory = [];
        render();
    }

    /**
     * Adds more stocks to the queue.
     */
    function addStocks(newStocks) {
        stocks = [...stocks, ...newStocks];
        render();
    }

    // ========================================================================
    // RENDERING
    // ========================================================================
    
    /**
     * Renders the card stack.
     */
    function render() {
        if (!cardStack) return;

        // Clear existing cards
        cardStack.innerHTML = '';

        // Check if we have stocks to show
        if (currentIndex >= stocks.length) {
            renderEmptyState();
            onEmpty();
            return;
        }

        // Render up to STACK_SIZE cards
        const cardsToRender = stocks.slice(currentIndex, currentIndex + CONFIG.STACK_SIZE);
        
        // Render in reverse order so the first card is on top
        cardsToRender.reverse().forEach((stock, reverseIndex) => {
            const index = CONFIG.STACK_SIZE - 1 - reverseIndex;
            const card = createCard(stock, index);
            cardStack.appendChild(card);
        });

        // Set up event listeners on the top card
        currentCard = cardStack.querySelector('[data-index="0"]');
        if (currentCard) {
            setupCardEvents(currentCard);
        }
    }

    /**
     * Creates a card element for a stock.
     */
    function createCard(stock, index) {
        const card = document.createElement('div');
        card.className = 'stock-card';
        card.dataset.index = index;
        card.dataset.ticker = stock.ticker;

        // Determine growth rate display class
        const growthClass = stock.growthRate >= 0 ? 'positive' : 'negative';
        
        // Safety score color based on value
        const safetyColor = getSafetyColor(stock.safetyScore);

        card.innerHTML = `
            <!-- Swipe indicators - appear during drag -->
            <div class="swipe-indicator like">SAVE</div>
            <div class="swipe-indicator pass">PASS</div>
            
            <!-- Card header with ticker and company info -->
            <div class="card-header">
                <div class="card-ticker-row">
                    <span class="card-ticker">${stock.ticker}</span>
                    <span class="card-category-badge ${stock.category}">${formatCategory(stock.category)}</span>
                </div>
                <div class="card-name">${stock.name || stock.ticker}</div>
                <div class="card-sector">${stock.sector || 'Unknown Sector'}</div>
            </div>
            
            <!-- Main yield display - the hero number -->
            <div class="card-yield-section">
                <div class="yield-value">${stock.dividendYield.toFixed(2)}%</div>
                <div class="yield-label">Dividend Yield</div>
            </div>
            
            <!-- Key metrics grid -->
            <div class="card-metrics">
                <div class="metric-item">
                    <div class="metric-value">$${(stock.annualDividend || 0).toFixed(2)}</div>
                    <div class="metric-label">Annual Div</div>
                </div>
                <div class="metric-item">
                    <div class="metric-value ${growthClass}">${stock.growthRate >= 0 ? '+' : ''}${stock.growthRate.toFixed(1)}%</div>
                    <div class="metric-label">5Y Growth</div>
                </div>
                <div class="metric-item">
                    <div class="metric-value">${stock.consecutiveYears || 0}y</div>
                    <div class="metric-label">Streak</div>
                </div>
            </div>
            
            <!-- Additional metrics row -->
            <div class="card-metrics">
                <div class="metric-item">
                    <div class="metric-value">${(stock.payoutRatio || 0).toFixed(0)}%</div>
                    <div class="metric-label">Payout Ratio</div>
                </div>
                <div class="metric-item">
                    <div class="metric-value">$${formatPrice(stock.price)}</div>
                    <div class="metric-label">Price</div>
                </div>
                <div class="metric-item">
                    <div class="metric-value">${stock.paymentFrequency || 'N/A'}</div>
                    <div class="metric-label">Frequency</div>
                </div>
            </div>
            
            <!-- Safety score visualization -->
            <div class="card-safety">
                <div class="safety-header">
                    <span class="safety-label">Safety Score</span>
                    <span class="safety-value" style="color: ${safetyColor}">${stock.safetyScore}/100</span>
                </div>
                <div class="safety-bar">
                    <div class="safety-fill" style="width: ${stock.safetyScore}%; background: ${safetyColor}"></div>
                </div>
            </div>
        `;

        return card;
    }

    /**
     * Renders an empty state when no more cards.
     */
    function renderEmptyState() {
        cardStack.innerHTML = `
            <div style="text-align: center; padding: 48px; color: var(--text-muted);">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 16px; opacity: 0.5;">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M8 12h8M12 8v8"></path>
                </svg>
                <p style="margin-bottom: 8px;">No more stocks to review</p>
                <p style="font-size: 0.75rem;">Try changing filters or refreshing</p>
            </div>
        `;
    }

    // ========================================================================
    // GESTURE HANDLING
    // ========================================================================
    
    /**
     * Sets up touch and mouse events on a card.
     */
    function setupCardEvents(card) {
        // Touch events
        card.addEventListener('touchstart', handleDragStart, { passive: true });
        card.addEventListener('touchmove', handleDragMove, { passive: false });
        card.addEventListener('touchend', handleDragEnd);
        card.addEventListener('touchcancel', handleDragEnd);

        // Mouse events for desktop
        card.addEventListener('mousedown', handleDragStart);
    }

    /**
     * Handles drag start (touchstart or mousedown).
     */
    function handleDragStart(e) {
        if (!currentCard) return;

        isDragging = true;
        startTime = Date.now();

        // Get starting position
        if (e.type === 'touchstart') {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        } else {
            startX = e.clientX;
            startY = e.clientY;
            
            // Add document-level mouse listeners
            document.addEventListener('mousemove', handleDragMove);
            document.addEventListener('mouseup', handleDragEnd);
        }

        currentX = startX;
        currentY = startY;

        // Remove transition during drag for responsiveness
        currentCard.style.transition = 'none';
    }

    /**
     * Handles drag move (touchmove or mousemove).
     */
    function handleDragMove(e) {
        if (!isDragging || !currentCard) return;

        // Prevent scrolling while swiping
        if (e.cancelable) {
            e.preventDefault();
        }

        // Get current position
        if (e.type === 'touchmove') {
            currentX = e.touches[0].clientX;
            currentY = e.touches[0].clientY;
        } else {
            currentX = e.clientX;
            currentY = e.clientY;
        }

        // Calculate delta
        const deltaX = currentX - startX;
        const deltaY = currentY - startY;

        // Apply transform
        const rotation = deltaX * CONFIG.ROTATION_FACTOR;
        currentCard.style.transform = `translate(${deltaX}px, ${deltaY}px) rotate(${rotation}deg)`;

        // Show swipe indicators based on direction
        updateSwipeIndicators(deltaX);
    }

    /**
     * Handles drag end (touchend or mouseup).
     */
    function handleDragEnd(e) {
        if (!isDragging || !currentCard) return;

        isDragging = false;

        // Remove document-level mouse listeners
        document.removeEventListener('mousemove', handleDragMove);
        document.removeEventListener('mouseup', handleDragEnd);

        // Calculate final delta and velocity
        const deltaX = currentX - startX;
        const deltaTime = Date.now() - startTime;
        const velocity = Math.abs(deltaX) / deltaTime;

        // Get card width for threshold calculation
        const cardWidth = currentCard.offsetWidth;
        const threshold = cardWidth * CONFIG.SWIPE_THRESHOLD;

        // Determine if swipe was far/fast enough
        if (Math.abs(deltaX) > threshold || velocity > CONFIG.VELOCITY_THRESHOLD) {
            if (deltaX > 0) {
                completeSwipe('right');
            } else {
                completeSwipe('left');
            }
        } else {
            // Reset card position
            resetCard();
        }
    }

    /**
     * Updates swipe indicator visibility based on drag direction.
     */
    function updateSwipeIndicators(deltaX) {
        const likeIndicator = currentCard.querySelector('.swipe-indicator.like');
        const passIndicator = currentCard.querySelector('.swipe-indicator.pass');

        const threshold = 50; // Pixels before indicator starts showing
        const maxOpacity = 1;

        if (deltaX > threshold) {
            likeIndicator.style.opacity = Math.min((deltaX - threshold) / 100, maxOpacity);
            passIndicator.style.opacity = 0;
        } else if (deltaX < -threshold) {
            passIndicator.style.opacity = Math.min((-deltaX - threshold) / 100, maxOpacity);
            likeIndicator.style.opacity = 0;
        } else {
            likeIndicator.style.opacity = 0;
            passIndicator.style.opacity = 0;
        }
    }

    /**
     * Resets the card to its original position.
     */
    function resetCard() {
        if (!currentCard) return;

        currentCard.style.transition = `transform ${CONFIG.ANIMATION_DURATION}ms ease`;
        currentCard.style.transform = 'translate(0, 0) rotate(0deg)';

        // Hide indicators
        const indicators = currentCard.querySelectorAll('.swipe-indicator');
        indicators.forEach(ind => ind.style.opacity = 0);
    }

    // ========================================================================
    // SWIPE ACTIONS
    // ========================================================================
    
    /**
     * Completes a swipe animation and triggers callback.
     */
    function completeSwipe(direction) {
        if (!currentCard) return;

        const stock = stocks[currentIndex];
        const isRight = direction === 'right';

        // Animate card off screen
        const exitX = isRight ? window.innerWidth : -window.innerWidth;
        const exitRotation = isRight ? 30 : -30;

        currentCard.style.transition = `transform ${CONFIG.ANIMATION_DURATION}ms ease`;
        currentCard.style.transform = `translate(${exitX}px, 0) rotate(${exitRotation}deg)`;

        // Save to history for undo
        swipeHistory.push({
            stock,
            index: currentIndex,
            direction
        });

        // Wait for animation, then update state
        setTimeout(() => {
            currentIndex++;

            // Trigger callback
            if (isRight) {
                onSwipeRight(stock);
            } else {
                onSwipeLeft(stock);
            }

            // Re-render
            render();
        }, CONFIG.ANIMATION_DURATION);
    }

    /**
     * Programmatically swipes the current card left (pass).
     */
    function swipeLeft() {
        if (currentIndex >= stocks.length) return;
        completeSwipe('left');
    }

    /**
     * Programmatically swipes the current card right (like).
     */
    function swipeRight() {
        if (currentIndex >= stocks.length) return;
        completeSwipe('right');
    }

    /**
     * Undoes the last swipe.
     */
    function undo() {
        if (swipeHistory.length === 0) return null;

        const last = swipeHistory.pop();
        currentIndex = last.index;
        
        render();

        return last;
    }

    // ========================================================================
    // HELPERS
    // ========================================================================
    
    /**
     * Formats category for display.
     */
    function formatCategory(category) {
        switch (category) {
            case 'immediate': return 'Immediate';
            case 'longshot': return 'Long Shot';
            case 'balanced': return 'Balanced';
            default: return category || 'Unknown';
        }
    }

    /**
     * Gets color for safety score.
     */
    function getSafetyColor(score) {
        if (score >= 70) return '#2ecc71'; // Green
        if (score >= 50) return '#f39c12'; // Orange
        if (score >= 30) return '#e67e22'; // Dark orange
        return '#e74c3c'; // Red
    }

    /**
     * Formats price for display.
     */
    function formatPrice(price) {
        if (!price) return '0';
        if (price >= 1000) {
            return (price / 1000).toFixed(1) + 'k';
        }
        return price.toFixed(2);
    }

    /**
     * Gets the current stock (top of deck).
     */
    function getCurrentStock() {
        return stocks[currentIndex] || null;
    }

    /**
     * Gets remaining count.
     */
    function getRemainingCount() {
        return Math.max(0, stocks.length - currentIndex);
    }

    /**
     * Checks if undo is available.
     */
    function canUndo() {
        return swipeHistory.length > 0;
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================
    
    return {
        init,
        updateStocks,
        addStocks,
        swipeLeft,
        swipeRight,
        undo,
        getCurrentStock,
        getRemainingCount,
        canUndo,
        render
    };
})();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CardSwiper;
}
