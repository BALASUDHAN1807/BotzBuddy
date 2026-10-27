FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=3000

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY botzbuddy ./botzbuddy
COPY data ./data
COPY public ./public

EXPOSE 3000
CMD ["sh", "-c", "uvicorn botzbuddy.main:app --host 0.0.0.0 --port ${PORT}"]
