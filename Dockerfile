FROM node:20-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOME=/app
ENV XDG_CACHE_HOME=/app/.cache
ENV HF_HOME=/app/.cache/huggingface

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv \
  && python3 -m venv /opt/transcription \
  && /opt/transcription/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/transcription/bin/pip install --no-cache-dir faster-whisper \
  && /opt/transcription/bin/python3 -c "from faster_whisper import WhisperModel" \
  && rm -rf /var/lib/apt/lists/*

ENV PATH="/opt/transcription/bin:${PATH}"

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid 1001 nextjs

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/embedded ./embedded
COPY --from=builder ["/app/MB - Regular Clients.kml", "./MB - Regular Clients.kml"]
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/server.mjs ./server.mjs

RUN mkdir -p /app/data /app/.cache/huggingface && chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

CMD ["node", "server.mjs"]
