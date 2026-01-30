# Dividend Hunter - Dockerfile
FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .
COPY static ./static

RUN mkdir -p /app/data

EXPOSE 8000

# Use shell form so $PORT gets expanded
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port $PORT"]
