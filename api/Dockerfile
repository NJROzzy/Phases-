# PHASES laboratory API. Build from the repository root:
#   docker build -f api/Dockerfile -t phases-api .
#   docker run -p 8000:8000 -v phases-data:/data phases-api
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PHASES_DATA=/data HOST=0.0.0.0 PORT=8000

WORKDIR /app
COPY engine/ engine/
COPY api/ api/
RUN pip install --no-cache-dir ./engine ./api \
 && useradd --create-home phases && mkdir -p /data && chown phases /data

USER phases
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request,os; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/api/v1/health')"
CMD ["python", "-m", "phases_api"]
