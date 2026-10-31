# Build the dashboard, then run the firm. One container, one port.
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /firm
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ backend/
COPY --from=web /web/dist frontend/dist
RUN mkdir -p data
ENV HOST=0.0.0.0 PORT=8000 OLLAMA_URL=http://ollama:11434 DB_PATH=data/firm.db
EXPOSE 8000
WORKDIR /firm/backend
CMD ["python", "run.py"]
