# margixindia ML Service — Railway Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy ML modules
COPY . .

# Railway sets PORT via env var
CMD ["python", "main.py"]
