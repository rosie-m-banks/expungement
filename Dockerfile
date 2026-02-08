FROM python:3.12-slim

WORKDIR /app

# Copy everything into the image
COPY . .

# The PORT env var is set by most cloud platforms (Render, Railway, Fly, etc.)
ENV PORT=8000

EXPOSE ${PORT}

CMD ["python", "web_server.py"]

