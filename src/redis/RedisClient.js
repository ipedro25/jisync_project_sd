const Redis = require("ioredis");

const client = new Redis(process.env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 0,   // cada comando falha rápido se não há ligação (mantém-se como estava)
  enableOfflineQueue: false, // não acumula comandos à espera de ligação (mantém-se como estava)

  // Backoff crescente, sem limite de tentativas — nunca desiste de vez.
  // ANTES: `retryStrategy: () => null` fazia o ioredis desistir de
  // reconectar para sempre após a primeira falha, mesmo que o Redis
  // voltasse a ficar disponível pouco depois — só um reinício do
  // servidor Node resolvia. Isto foi a causa real dos erros
  // "Connection is closed" persistentes no autosave.
  retryStrategy: (times) => Math.min(times * 500, 5000),
});

let isDown = false;

client.on("connect", () => {
  console.log(isDown ? "[Redis] Ligação restabelecida" : "[Redis] Ligado com sucesso");
  isDown = false;
});

// Avisa uma vez quando cai (não a cada tentativa falhada, para não inundar os logs)
client.on("error", (err) => {
  if (!isDown) {
    console.warn("[Redis] Indisponível — a tentar reconectar em segundo plano:", err.message);
    isDown = true;
  }
});

module.exports = client;