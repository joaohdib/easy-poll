import { mkdirSync } from 'node:fs';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import {
  drizzle,
  type BetterSQLite3Database
} from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const IN_MEMORY_DATABASE = ':memory:';

export interface DatabaseConnection {
  sqlite: BetterSqlite3.Database;
  db: EasyPollDatabase;
  databasePath: string;
  checkDatabaseConnection(): boolean;
  closeDatabase(): void;
}

export type EasyPollDatabase = BetterSQLite3Database<typeof schema>;

export function resolveDefaultDatabasePath(moduleDirectory = __dirname): string {
  const projectRoot = path.resolve(moduleDirectory, '..', '..');
  return path.join(projectRoot, 'data', 'easypoll.db');
}

export function ensureDatabaseDirectory(databaseFilePath: string): void {
  if (databaseFilePath === IN_MEMORY_DATABASE) return;
  mkdirSync(path.dirname(path.resolve(databaseFilePath)), { recursive: true });
}

export function createDatabase(databaseFilePath: string): DatabaseConnection {
  const normalizedPath = databaseFilePath === IN_MEMORY_DATABASE
    ? IN_MEMORY_DATABASE
    : path.resolve(databaseFilePath);

  ensureDatabaseDirectory(normalizedPath);

  const sqlite = new BetterSqlite3(normalizedPath);
  try {
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });

    return {
      sqlite,
      db,
      databasePath: normalizedPath,
      checkDatabaseConnection(): boolean {
        const result = db.get<{ value: number }>(sql`SELECT 1 AS value`);
        return result?.value === 1;
      },
      closeDatabase(): void {
        if (sqlite.open) sqlite.close();
      }
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
