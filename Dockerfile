FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8501

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY botzbuddy ./botzbuddy
COPY data ./data
COPY .streamlit ./.streamlit
COPY streamlit_app.py .

EXPOSE 8501
# Streamlit app by default. For the REST API instead:
#   docker run -p 8000:8000 botzbuddy uvicorn botzbuddy.main:app --host 0.0.0.0 --port 8000
CMD ["sh", "-c", "streamlit run streamlit_app.py --server.port ${PORT} --server.address 0.0.0.0 --server.headless true"]
