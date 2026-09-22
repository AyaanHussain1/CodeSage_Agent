FROM python:3.11-slim

WORKDIR /app

# Install dependencies first (better Docker layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the whole project — server.py imports embedding_and_retrieving.py,
# prompting_llm.py, and file_reading.py from the repo root via sys.path.append
COPY . .

WORKDIR /app/backend

EXPOSE 8080

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
