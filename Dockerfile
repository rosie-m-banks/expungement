FROM python:3.12-slim

WORKDIR /app

# Install dependencies in a cache-friendly layer.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application into the image.
COPY . .

# The PORT env var is set by most cloud platforms (Render, Railway, Fly, etc.)
ENV PORT=8000

EXPOSE ${PORT}

CMD ["python", "web_server.py"]
