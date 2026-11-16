# Xyro AI backend service — Python (FastAPI) + C watermark core.
# Build:  docker build -t xyro-backend backend/
# Run:    docker run -p 8000:8000 --env-file backend.env xyro-backend
FROM python:3.12-slim

# gcc builds the C watermark core; no build tools remain in the
# final layer's runtime path beyond the compiled .so.
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc make \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ app/
COPY c/ c/
RUN make -C c

ENV PYTHONUNBUFFERED=1
EXPOSE 8000
# Single worker by design: chat jobs are asyncio tasks in one
# process and the job registry is in-process (see app/main.py).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
