# ResumeSmith: the page, plus the Chromium that renders finished PDFs.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/browsers \
    PYTHONPATH=/app/src \
    HOST=0.0.0.0 \
    PORT=8000

WORKDIR /app

# Chromium and its system libraries are the heavy part, so they go in their own layer.
COPY requirements.txt ./
RUN pip install -r requirements.txt \
 && playwright install --with-deps chromium

COPY src/ ./src/
COPY site/ ./site/
COPY templates/ ./templates/
COPY resumes/example.yaml ./resumes/example.yaml

# A plain user: nothing here needs root, and Chromium is happier not running as one.
RUN useradd --create-home --uid 10001 resumesmith \
 && chown -R resumesmith:resumesmith /app /opt/browsers
USER resumesmith

EXPOSE 8000
CMD ["python", "-m", "resumesmith", "serve", "--no-open"]
