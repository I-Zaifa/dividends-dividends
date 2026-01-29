# ============================================================================
# DIVIDEND HUNTER - Backend Dockerfile
# ============================================================================
# 
# This creates a container image for the FastAPI backend.
# It includes Python, yfinance, and serves the frontend static files.
#
# BUILD:
#   docker build -t dividend-hunter-backend ./backend
#
# RUN:
#   docker run -p 8000:8000 dividend-hunter-backend
#
# NOTES:
# - Uses slim Python image for smaller size
# - Installs dependencies first for better caching
# - Copies frontend for static file serving
# - Runs with gunicorn for production
# ============================================================================

# Use official Python slim image - good balance of size and compatibility
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Set environment variables
# Prevents Python from writing pyc files and buffering stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    # Disable pip version warnings
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Install system dependencies
# gcc is needed for some Python packages to compile
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first (better Docker caching)
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY main.py .

# Copy frontend (for static file serving)
# In production, you might serve frontend from a CDN instead
COPY ../frontend /app/frontend

# Create data directory for persistence
# In production, mount this as a volume
RUN mkdir -p /app/data

# Expose the port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/ || exit 1

# Run with gunicorn for production
# - 4 workers (adjust based on CPU cores)
# - uvicorn workers for async support
# - bind to 0.0.0.0 to accept external connections
CMD ["gunicorn", "main:app", \
     "--workers", "4", \
     "--worker-class", "uvicorn.workers.UvicornWorker", \
     "--bind", "0.0.0.0:8000", \
     "--access-logfile", "-", \
     "--error-logfile", "-"]
