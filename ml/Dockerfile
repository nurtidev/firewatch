FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# libgomp1 is required by xgboost at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Train, calibrate and validate the model at build time. The quality gate in
# train.train exits non-zero (failing the build) if ROC-AUC drops below floor,
# so a regressed model can never ship. Artifacts are baked into the image.
RUN python -m train.train

# Bind IPv6 (::) — Railway private networking is IPv6; also serves IPv4.
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host :: --port ${PORT}"]
