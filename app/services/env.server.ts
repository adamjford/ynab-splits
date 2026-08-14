import { z } from "zod";

const envSchema = z.object({
  APP_ORIGIN: z.string().url(),
  DATABASE_PATH: z.string().min(1),
  SESSION_SECRET: z.string().min(1),
  TOKEN_ENCRYPTION_KEY: z.string().length(32),
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
