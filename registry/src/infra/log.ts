import pino from "pino";

/** Log estruturado do servico. Nivel por ambiente, via LOG_LEVEL. */
export const log = pino({ level: process.env.LOG_LEVEL ?? "info" });