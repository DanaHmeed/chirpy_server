import type { MigrationConfig } from "drizzle-orm/migrator";

process.loadEnvFile();

const migrationConfig: MigrationConfig = {
  migrationsFolder: "./src/db/migrations",
};

export type APIConfig = {
  fileserverHits: number;
  port: number;
  platform: string;
  jwtSecret: string;
  polkaKey: string;
};
export type DBConfig = {
  url: string;
  migrationConfig: MigrationConfig;
};

export type Config = {
  api: APIConfig;
  db: DBConfig;
};

function envOrThrow(key: string): string {
  const value = process.env[key];

  if (!value) {
    throw new Error(`Environment variable ${key} is not set`);
  }

  return value;
}
export const config: Config = {
  api: {
    fileserverHits: 0,
    port: Number(envOrThrow("PORT")),
    platform: envOrThrow("PLATFORM"),
    jwtSecret: envOrThrow("JWT_SECRET"),
    polkaKey: envOrThrow("POLKA_KEY"),
  },

  db: {
    url: envOrThrow("DB_URL"),
    migrationConfig,
  },
};