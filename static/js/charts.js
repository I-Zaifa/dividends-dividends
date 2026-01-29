/**
 * ============================================================================
 * DIVIDEND HUNTER - Charts & Trend Visualization
 * ============================================================================
 * 
 * This module handles all the visual trend analysis using data that's been
 * saved over time in IndexedDB. The key insight here is that we're NOT
 * relying on external chart libraries - we're drawing on canvas directly
 * for maximum control and minimal dependencies.
 * 
 * WHAT WE VISUALIZE:
 * ------------------
 * 1. Yield trends over time
 * 2. Price vs yield correlation
 * 3. Safety score changes
 * 4. Growth rate trajectory
 * 5. Portfolio composition (pie/donut)
 * 
 * WHY CANVAS INSTEAD OF CHART.JS?
 * -------------------------------
 * - Smaller bundle size (we're PWA, every KB counts)
 * - Full control over aesthetics
 * - Offline-first (no CDN dependency)
 * - Custom interactions exactly how we want them
 * 
 * The tradeoff is more code, but it's worth it for a polished feel.
 */

const DividendCharts = (function() {
    'use strict';

    // ========================================================================
    // CONFIGURATION
    // ========================================================================
    
    // Color palette matching the app theme
    const COLORS = {
        background: '#0a0a0f',
        cardBg: '#1a1a24',
        gridLine: 'rgba(255, 255, 255, 0.05)',
        accent: '#d4a853',
        accentLight: '#f4d03f',
        positive: '#2ecc71',
        negative: '#e74c3c',
        warning: '#f39c12',
        textPrimary: '#ffffff',
        textSecondary: '#a0a0b0',
        textMuted: '#606070'
    };

    // Chart padding/margins
    const PADDING = {
        top: 20,
        right: 20,
        bottom: 40,
        left: 50
    };

    // ========================================================================
    // UTILITY FUNCTIONS
    // ========================================================================
    
    /**
     * Gets device pixel ratio for crisp rendering on retina displays.
     */
    function getPixelRatio() {
        return window.devicePixelRatio || 1;
    }

    /**
     * Sets up a canvas for high-DPI rendering.
     * This is crucial for crisp lines on retina screens.
     */
    function setupCanvas(canvas, width, height) {
        const ratio = getPixelRatio();
        
        // Set display size
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        
        // Set actual size in memory (scaled for retina)
        canvas.width = width * ratio;
        canvas.height = height * ratio;
        
        // Scale context to match
        const ctx = canvas.getContext('2d');
        ctx.scale(ratio, ratio);
        
        return ctx;
    }

    /**
     * Clears a canvas with the background color.
     */
    function clearCanvas(ctx, width, height) {
        ctx.fillStyle = COLORS.cardBg;
        ctx.fillRect(0, 0, width, height);
    }

    /**
     * Formats a number for display on axes.
     */
    function formatNumber(value, decimals = 1) {
        if (Math.abs(value) >= 1000000) {
            return (value / 1000000).toFixed(decimals) + 'M';
        }
        if (Math.abs(value) >= 1000) {
            return (value / 1000).toFixed(decimals) + 'K';
        }
        return value.toFixed(decimals);
    }

    /**
     * Formats a date for display.
     */
    function formatDate(dateStr) {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    /**
     * Calculates nice tick values for an axis.
     */
    function calculateTicks(min, max, targetTicks = 5) {
        const range = max - min;
        const roughStep = range / targetTicks;
        
        // Round to a nice number
        const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
        const residual = roughStep / magnitude;
        
        let niceStep;
        if (residual > 5) niceStep = 10 * magnitude;
        else if (residual > 2) niceStep = 5 * magnitude;
        else if (residual > 1) niceStep = 2 * magnitude;
        else niceStep = magnitude;
        
        const niceMin = Math.floor(min / niceStep) * niceStep;
        const niceMax = Math.ceil(max / niceStep) * niceStep;
        
        const ticks = [];
        for (let v = niceMin; v <= niceMax; v += niceStep) {
            ticks.push(v);
        }
        
        return { min: niceMin, max: niceMax, ticks, step: niceStep };
    }

    // ========================================================================
    // LINE CHART - For yield trends over time
    // ========================================================================
    
    /**
     * Draws a line chart showing how a metric changes over time.
     * 
     * @param {HTMLCanvasElement} canvas - Target canvas element
     * @param {Array} data - Array of { date, value } objects
     * @param {Object} options - Configuration options
     */
    function drawLineChart(canvas, data, options = {}) {
        const {
            width = canvas.parentElement?.clientWidth || 300,
            height = 200,
            color = COLORS.accent,
            fillGradient = true,
            showPoints = true,
            showGrid = true,
            yLabel = 'Value',
            valueFormatter = (v) => v.toFixed(2)
        } = options;

        if (!data || data.length < 2) {
            drawNoDataMessage(canvas, width, height);
            return;
        }

        const ctx = setupCanvas(canvas, width, height);
        clearCanvas(ctx, width, height);

        // Calculate chart area
        const chartLeft = PADDING.left;
        const chartRight = width - PADDING.right;
        const chartTop = PADDING.top;
        const chartBottom = height - PADDING.bottom;
        const chartWidth = chartRight - chartLeft;
        const chartHeight = chartBottom - chartTop;

        // Calculate data bounds
        const values = data.map(d => d.value);
        const minValue = Math.min(...values);
        const maxValue = Math.max(...values);
        const { min: yMin, max: yMax, ticks: yTicks } = calculateTicks(minValue, maxValue);

        // Scale functions
        const xScale = (i) => chartLeft + (i / (data.length - 1)) * chartWidth;
        const yScale = (v) => chartBottom - ((v - yMin) / (yMax - yMin)) * chartHeight;

        // Draw grid lines
        if (showGrid) {
            ctx.strokeStyle = COLORS.gridLine;
            ctx.lineWidth = 1;
            
            // Horizontal grid lines
            yTicks.forEach(tick => {
                const y = yScale(tick);
                ctx.beginPath();
                ctx.moveTo(chartLeft, y);
                ctx.lineTo(chartRight, y);
                ctx.stroke();
            });
        }

        // Draw Y axis labels
        ctx.fillStyle = COLORS.textMuted;
        ctx.font = '10px "DM Sans", sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        
        yTicks.forEach(tick => {
            const y = yScale(tick);
            ctx.fillText(valueFormatter(tick), chartLeft - 8, y);
        });

        // Draw X axis labels (show a few dates)
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        
        const labelInterval = Math.ceil(data.length / 5);
        data.forEach((d, i) => {
            if (i % labelInterval === 0 || i === data.length - 1) {
                const x = xScale(i);
                ctx.fillText(formatDate(d.date), x, chartBottom + 8);
            }
        });

        // Draw fill gradient under the line
        if (fillGradient) {
            const gradient = ctx.createLinearGradient(0, chartTop, 0, chartBottom);
            gradient.addColorStop(0, color + '40'); // 25% opacity
            gradient.addColorStop(1, color + '00'); // 0% opacity
            
            ctx.beginPath();
            ctx.moveTo(xScale(0), chartBottom);
            
            data.forEach((d, i) => {
                ctx.lineTo(xScale(i), yScale(d.value));
            });
            
            ctx.lineTo(xScale(data.length - 1), chartBottom);
            ctx.closePath();
            ctx.fillStyle = gradient;
            ctx.fill();
        }

        // Draw the line
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        
        data.forEach((d, i) => {
            const x = xScale(i);
            const y = yScale(d.value);
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        
        ctx.stroke();

        // Draw data points
        if (showPoints && data.length <= 30) {
            data.forEach((d, i) => {
                const x = xScale(i);
                const y = yScale(d.value);
                
                // Outer circle
                ctx.beginPath();
                ctx.arc(x, y, 4, 0, Math.PI * 2);
                ctx.fillStyle = COLORS.cardBg;
                ctx.fill();
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.stroke();
            });
        }

        // Draw Y axis label
        ctx.save();
        ctx.translate(12, chartTop + chartHeight / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = COLORS.textMuted;
        ctx.textAlign = 'center';
        ctx.fillText(yLabel, 0, 0);
        ctx.restore();
    }

    // ========================================================================
    // MULTI-LINE CHART - For comparing multiple stocks
    // ========================================================================
    
    /**
     * Draws multiple lines on the same chart for comparison.
     */
    function drawMultiLineChart(canvas, datasets, options = {}) {
        const {
            width = canvas.parentElement?.clientWidth || 300,
            height = 200,
            showLegend = true
        } = options;

        if (!datasets || datasets.length === 0) {
            drawNoDataMessage(canvas, width, height);
            return;
        }

        const ctx = setupCanvas(canvas, width, height);
        clearCanvas(ctx, width, height);

        // Predefined colors for different lines
        const lineColors = [
            COLORS.accent,
            COLORS.positive,
            COLORS.warning,
            '#9b59b6',
            '#3498db'
        ];

        // Calculate chart area
        const legendHeight = showLegend ? 30 : 0;
        const chartLeft = PADDING.left;
        const chartRight = width - PADDING.right;
        const chartTop = PADDING.top;
        const chartBottom = height - PADDING.bottom - legendHeight;
        const chartWidth = chartRight - chartLeft;
        const chartHeight = chartBottom - chartTop;

        // Find global min/max across all datasets
        let allValues = [];
        datasets.forEach(ds => {
            ds.data.forEach(d => allValues.push(d.value));
        });
        
        const { min: yMin, max: yMax, ticks: yTicks } = calculateTicks(
            Math.min(...allValues),
            Math.max(...allValues)
        );

        // Find common date range
        const allDates = [...new Set(datasets.flatMap(ds => ds.data.map(d => d.date)))].sort();
        
        // Scale functions
        const xScale = (date) => {
            const index = allDates.indexOf(date);
            return chartLeft + (index / (allDates.length - 1)) * chartWidth;
        };
        const yScale = (v) => chartBottom - ((v - yMin) / (yMax - yMin)) * chartHeight;

        // Draw grid
        ctx.strokeStyle = COLORS.gridLine;
        ctx.lineWidth = 1;
        yTicks.forEach(tick => {
            const y = yScale(tick);
            ctx.beginPath();
            ctx.moveTo(chartLeft, y);
            ctx.lineTo(chartRight, y);
            ctx.stroke();
        });

        // Draw Y axis labels
        ctx.fillStyle = COLORS.textMuted;
        ctx.font = '10px "DM Sans", sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        yTicks.forEach(tick => {
            ctx.fillText(tick.toFixed(1), chartLeft - 8, yScale(tick));
        });

        // Draw each dataset
        datasets.forEach((ds, dsIndex) => {
            const color = lineColors[dsIndex % lineColors.length];
            
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            
            ds.data.forEach((d, i) => {
                const x = xScale(d.date);
                const y = yScale(d.value);
                
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            
            ctx.stroke();
        });

        // Draw legend
        if (showLegend) {
            const legendY = height - PADDING.bottom + 10;
            let legendX = chartLeft;
            
            ctx.font = '11px "DM Sans", sans-serif';
            
            datasets.forEach((ds, dsIndex) => {
                const color = lineColors[dsIndex % lineColors.length];
                
                // Color swatch
                ctx.fillStyle = color;
                ctx.fillRect(legendX, legendY, 12, 12);
                
                // Label
                ctx.fillStyle = COLORS.textSecondary;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(ds.label, legendX + 16, legendY + 6);
                
                legendX += ctx.measureText(ds.label).width + 30;
            });
        }
    }

    // ========================================================================
    // DONUT CHART - For portfolio composition
    // ========================================================================
    
    /**
     * Draws a donut chart showing portfolio breakdown by sector or category.
     */
    function drawDonutChart(canvas, data, options = {}) {
        const {
            width = 200,
            height = 200,
            innerRadius = 0.6, // As fraction of outer radius
            showLabels = true,
            showPercentages = true
        } = options;

        if (!data || data.length === 0) {
            drawNoDataMessage(canvas, width, height);
            return;
        }

        const ctx = setupCanvas(canvas, width, height);
        clearCanvas(ctx, width, height);

        // Donut colors - varied palette
        const sliceColors = [
            '#d4a853', '#2ecc71', '#3498db', '#9b59b6', '#e74c3c',
            '#f39c12', '#1abc9c', '#e91e63', '#00bcd4', '#8bc34a'
        ];

        const centerX = width / 2;
        const centerY = height / 2;
        const outerRadius = Math.min(width, height) / 2 - 20;
        const innerRadiusPx = outerRadius * innerRadius;

        // Calculate total
        const total = data.reduce((sum, item) => sum + item.value, 0);

        // Draw slices
        let startAngle = -Math.PI / 2; // Start from top
        
        data.forEach((item, i) => {
            const sliceAngle = (item.value / total) * Math.PI * 2;
            const endAngle = startAngle + sliceAngle;
            const color = sliceColors[i % sliceColors.length];
            
            // Draw slice
            ctx.beginPath();
            ctx.moveTo(
                centerX + innerRadiusPx * Math.cos(startAngle),
                centerY + innerRadiusPx * Math.sin(startAngle)
            );
            ctx.arc(centerX, centerY, outerRadius, startAngle, endAngle);
            ctx.arc(centerX, centerY, innerRadiusPx, endAngle, startAngle, true);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
            
            // Add subtle border between slices
            ctx.strokeStyle = COLORS.cardBg;
            ctx.lineWidth = 2;
            ctx.stroke();
            
            // Draw label
            if (showLabels && sliceAngle > 0.3) { // Only if slice is big enough
                const midAngle = startAngle + sliceAngle / 2;
                const labelRadius = outerRadius + 15;
                const labelX = centerX + labelRadius * Math.cos(midAngle);
                const labelY = centerY + labelRadius * Math.sin(midAngle);
                
                ctx.fillStyle = COLORS.textSecondary;
                ctx.font = '10px "DM Sans", sans-serif';
                ctx.textAlign = midAngle > Math.PI / 2 && midAngle < 3 * Math.PI / 2 ? 'right' : 'left';
                ctx.textBaseline = 'middle';
                
                const label = showPercentages 
                    ? `${item.label} (${Math.round(item.value / total * 100)}%)`
                    : item.label;
                ctx.fillText(label, labelX, labelY);
            }
            
            startAngle = endAngle;
        });

        // Draw center text (total or label)
        ctx.fillStyle = COLORS.textPrimary;
        ctx.font = 'bold 24px "Space Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(data.length.toString(), centerX, centerY - 8);
        
        ctx.fillStyle = COLORS.textMuted;
        ctx.font = '10px "DM Sans", sans-serif';
        ctx.fillText('STOCKS', centerX, centerY + 12);
    }

    // ========================================================================
    // BAR CHART - For comparing yields across stocks
    // ========================================================================
    
    /**
     * Draws a horizontal bar chart for ranking comparison.
     */
    function drawBarChart(canvas, data, options = {}) {
        const {
            width = canvas.parentElement?.clientWidth || 300,
            height = Math.max(200, data.length * 32 + 40),
            barColor = COLORS.accent,
            showValues = true,
            valueFormatter = (v) => v.toFixed(2) + '%'
        } = options;

        if (!data || data.length === 0) {
            drawNoDataMessage(canvas, width, height);
            return;
        }

        const ctx = setupCanvas(canvas, width, height);
        clearCanvas(ctx, width, height);

        // Sort by value descending
        const sortedData = [...data].sort((a, b) => b.value - a.value);

        // Calculate dimensions
        const chartLeft = 80; // Space for labels
        const chartRight = width - PADDING.right - (showValues ? 50 : 10);
        const chartWidth = chartRight - chartLeft;
        const barHeight = 20;
        const barGap = 12;

        // Find max value for scaling
        const maxValue = Math.max(...sortedData.map(d => d.value));

        // Draw bars
        sortedData.forEach((item, i) => {
            const y = PADDING.top + i * (barHeight + barGap);
            const barWidth = (item.value / maxValue) * chartWidth;
            
            // Draw label
            ctx.fillStyle = COLORS.textSecondary;
            ctx.font = '12px "Space Mono", monospace';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(item.label, chartLeft - 8, y + barHeight / 2);
            
            // Draw bar background
            ctx.fillStyle = COLORS.gridLine;
            ctx.fillRect(chartLeft, y, chartWidth, barHeight);
            
            // Draw bar with gradient
            const gradient = ctx.createLinearGradient(chartLeft, 0, chartLeft + barWidth, 0);
            gradient.addColorStop(0, barColor);
            gradient.addColorStop(1, barColor + 'cc');
            
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.roundRect(chartLeft, y, barWidth, barHeight, 4);
            ctx.fill();
            
            // Draw value
            if (showValues) {
                ctx.fillStyle = COLORS.textPrimary;
                ctx.font = 'bold 11px "Space Mono", monospace';
                ctx.textAlign = 'left';
                ctx.fillText(valueFormatter(item.value), chartRight + 8, y + barHeight / 2);
            }
        });
    }

    // ========================================================================
    // SPARKLINE - Tiny inline chart for lists
    // ========================================================================
    
    /**
     * Draws a tiny sparkline chart that fits inline.
     * Used in portfolio list items to show mini trends.
     */
    function drawSparkline(canvas, data, options = {}) {
        const {
            width = 60,
            height = 20,
            lineColor = COLORS.accent,
            fillColor = null
        } = options;

        if (!data || data.length < 2) {
            return;
        }

        const ctx = setupCanvas(canvas, width, height);
        ctx.clearRect(0, 0, width, height);

        const values = data.map(d => typeof d === 'number' ? d : d.value);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min || 1;

        // Determine color based on trend
        const trending = values[values.length - 1] > values[0];
        const color = trending ? COLORS.positive : COLORS.negative;

        // Calculate points
        const points = values.map((v, i) => ({
            x: (i / (values.length - 1)) * width,
            y: height - ((v - min) / range) * (height - 4) - 2
        }));

        // Draw fill if specified
        if (fillColor) {
            ctx.beginPath();
            ctx.moveTo(0, height);
            points.forEach(p => ctx.lineTo(p.x, p.y));
            ctx.lineTo(width, height);
            ctx.closePath();
            ctx.fillStyle = fillColor;
            ctx.fill();
        }

        // Draw line
        ctx.beginPath();
        ctx.strokeStyle = lineColor || color;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        
        points.forEach((p, i) => {
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
        });
        
        ctx.stroke();

        // Draw end point
        const lastPoint = points[points.length - 1];
        ctx.beginPath();
        ctx.arc(lastPoint.x, lastPoint.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = lineColor || color;
        ctx.fill();
    }

    // ========================================================================
    // NO DATA STATE
    // ========================================================================
    
    function drawNoDataMessage(canvas, width, height) {
        const ctx = setupCanvas(canvas, width, height);
        clearCanvas(ctx, width, height);
        
        ctx.fillStyle = COLORS.textMuted;
        ctx.font = '12px "DM Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Not enough data for chart', width / 2, height / 2);
    }

    // ========================================================================
    // HIGH-LEVEL CHART FUNCTIONS
    // ========================================================================
    
    /**
     * Renders a yield trend chart for a single stock.
     * Uses historical data saved in IndexedDB.
     */
    async function renderYieldTrendChart(canvas, ticker) {
        const trendData = await DividendDB.getTrendData(ticker);
        
        if (!trendData || trendData.length < 2) {
            drawNoDataMessage(canvas, canvas.width, canvas.height);
            return;
        }

        const data = trendData.map(t => ({
            date: t.date,
            value: t.yield
        }));

        drawLineChart(canvas, data, {
            color: COLORS.accent,
            yLabel: 'Yield %',
            valueFormatter: (v) => v.toFixed(2) + '%'
        });
    }

    /**
     * Renders portfolio composition by sector.
     */
    async function renderPortfolioComposition(canvas) {
        const portfolio = await DividendDB.getPortfolio();
        
        if (!portfolio || portfolio.length === 0) {
            drawNoDataMessage(canvas, 200, 200);
            return;
        }

        // Group by sector
        const bySector = {};
        portfolio.forEach(stock => {
            const sector = stock.sector || 'Unknown';
            bySector[sector] = (bySector[sector] || 0) + 1;
        });

        const data = Object.entries(bySector).map(([label, value]) => ({
            label,
            value
        }));

        drawDonutChart(canvas, data);
    }

    /**
     * Renders a comparison chart of portfolio yields.
     */
    async function renderYieldComparison(canvas) {
        const portfolio = await DividendDB.getPortfolio();
        
        if (!portfolio || portfolio.length === 0) {
            drawNoDataMessage(canvas, 300, 200);
            return;
        }

        const data = portfolio.slice(0, 10).map(stock => ({
            label: stock.ticker,
            value: stock.dividendYield
        }));

        drawBarChart(canvas, data);
    }

    /**
     * Compares yield trends of multiple stocks.
     */
    async function renderMultiStockComparison(canvas, tickers) {
        const datasets = [];
        
        for (const ticker of tickers.slice(0, 5)) {
            const trendData = await DividendDB.getTrendData(ticker);
            if (trendData && trendData.length >= 2) {
                datasets.push({
                    label: ticker,
                    data: trendData.map(t => ({ date: t.date, value: t.yield }))
                });
            }
        }

        drawMultiLineChart(canvas, datasets);
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================
    
    return {
        // Low-level drawing functions
        drawLineChart,
        drawMultiLineChart,
        drawDonutChart,
        drawBarChart,
        drawSparkline,
        
        // High-level rendering functions
        renderYieldTrendChart,
        renderPortfolioComposition,
        renderYieldComparison,
        renderMultiStockComparison,
        
        // Constants
        COLORS
    };
})();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DividendCharts;
}
