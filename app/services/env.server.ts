import { z } from "zod";

const placeholderSecret = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  return normalized.includes("replace-with") ||
    normalized.includes("change-me") ||
    normalized.includes("your-") ||
    normalized.includes("example") ||
    normalized.includes("sample") ||
    normalized === "session-secret" ||
    /^0+$/.test(normalized) ||
    /^0123456789+$/.test(normalized);
};

const sessionSecret = z.string().refine((value) => Buffer.byteLength(value, "utf8") >= 32, "SESSION_SECRET must be at least 32 UTF-8 bytes").refine((value) => !placeholderSecret(value), "SESSION_SECRET must not be a placeholder");
const tokenEncryptionKey = z.string().refine((value) => Buffer.byteLength(value, "utf8") === 32, "TOKEN_ENCRYPTION_KEY must encode to exactly 32 UTF-8 bytes").refine((value) => !placeholderSecret(value), "TOKEN_ENCRYPTION_KEY must not be a placeholder");
const envSchema = z.object({
  APP_ORIGIN: z.string().url(),
  DATABASE_PATH: z.string().min(1),
  SESSION_SECRET: sessionSecret,
  TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
  YNAB_CLIENT_ID: z.string().min(1),
  YNAB_CLIENT_SECRET: z.string().min(1),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(input: Record<string, string | undefined>): AppEnv {
  return envSchema.parse(input);
}

export function getEnv(): AppEnv {
  return parseEnv(process.env);
}
