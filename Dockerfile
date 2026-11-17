FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY hardhat.config.ts tsconfig.json ./
COPY contracts/ ./contracts/
COPY scripts/ ./scripts/
COPY src/ ./src/
COPY registry/ ./registry/
COPY test/ ./test/
RUN npx hardhat compile

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY tsconfig.json ./

COPY --from=build /app/artifacts/contracts/MobyContractRegistry.sol/MobyContractRegistry.json ./abi/MobyContractRegistry.json
COPY --from=build /app/artifacts/contracts/RegistroDeParticipantes.sol/RegistroDeParticipantes.json ./abi/RegistroDeParticipantes.json
COPY --from=build /app/src/ ./src/
COPY --from=build /app/registry/ ./registry/
RUN sed -i 's/\r$//' /app/registry/entrypoint.sh && chmod +x /app/registry/entrypoint.sh

RUN npm install --no-save ts-node@10 typescript@5 @types/node@24

ENV CAMINHO_ABI=/app/abi/MobyContractRegistry.json
ENV CAMINHO_ABI_PARTICIPANTES=/app/abi/RegistroDeParticipantes.json
ENV DB_HOST=postgres
ENV DB_PORT=5432
ENV DB_NAME=registry
ENV DB_USER=postgres
ENV DB_PASSWORD=postgres
ENV DB_SSL=false
ENV DB_POOL_MAX=10
ENV NODE_EXTRA_CA_CERTS=/app/certs/ca.crt

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/saude').then(r=>r.json()).then(s=>process.exit(s.status==='ok'?0:1)).catch(()=>process.exit(1))"

CMD ["/app/registry/entrypoint.sh"]