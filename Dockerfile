# GridWise — Dockerfile
# Bun-based, multi-stage. Pinned base (no :latest). No secrets inside.
# Build:  docker build -t gridwise:<tag> .
# Run:    docker run --rm -p 3000:3000 \
#           -e OPENROUTER_KEY=... -e GEMINI_KEY=... \
#           gridwise:<tag>

# ---- deps stage ----
FROM oven/bun:1.4.2 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---- build stage ----
FROM oven/bun:1.4.2 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

# ---- runtime stage ----
FROM oven/bun:1.4.2
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

EXPOSE 3000

# Run as non-root. The oven/bun image ships a `bun` user at uid 1000.
USER bun

CMD ["bun", "run", "start"]
