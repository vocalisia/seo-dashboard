import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
  transport: isDev
    ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
    : undefined,
  base: { env: process.env.VERCEL_ENV || "local" },
});

export function logError(
  context: string,
  err: unknown,
  extra: Record<string, unknown> = {}
): void {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  logger.error({ ctx: context, err: msg, stack, ...extra });
}
