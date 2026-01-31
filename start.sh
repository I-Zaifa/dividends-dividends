#!/bin/bash
# Railway startup script - ensures data directory exists before starting app

echo "🚀 Starting Dividend Hunter on Railway..."

# Create data directory if it doesn't exist
mkdir -p data

# Check if cache files exist
if [ -f "data/latest_snapshot.json" ]; then
    echo "✅ Found cached data ($(du -h data/latest_snapshot.json | cut -f1))"
else
    echo "⚠️  No cached data found - will fetch on first request"
fi

# Start the application
echo "🌐 Starting uvicorn on port ${PORT:-8000}..."
exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
