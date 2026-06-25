
# Stage 1: Build
FROM python:3.12-slim as builder

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc libpq-dev && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip wheel --no-cache-dir --no-deps --wheel-dir /app/wheels -r requirements.txt

# Stage 2: Run
FROM python:3.12-slim

WORKDIR /app

# Install system dependencies (libpq-dev para asyncpg, tesseract/poppler para OCR de PDFs escaneados)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libpq-dev \
        tesseract-ocr \
        tesseract-ocr-spa \
        poppler-utils && \
    rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY --from=builder /app/wheels /wheels
COPY --from=builder /app/requirements.txt .

RUN pip install --no-cache /wheels/*

# Copy project
COPY . .

# Run as non-root user for security; appuser necesita poder escribir en /app
# (crea uploads/customers, uploads/finance, etc. al arrancar)
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
