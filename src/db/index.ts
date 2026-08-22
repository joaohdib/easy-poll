import type BetterSqlite3 from 'better-sqlite3';
import {
  createDatabase,
  type DatabaseConnection,
  type EasyPollDatabase,
  resolveDefaultDatabasePath
} from './database';
import { resolveMigrationsPath, runMigrations } from './migrate';

export const databasePath = resolveDefaultDatabasePath();
export const migrationsPath = resolveMigrationsPath();

let sharedConnection: DatabaseConnection | null = null;

export function initializeDatabase(): DatabaseConnection {
  if (sharedConnection?.sqlite.open) return sharedConnection;

  let connection: DatabaseConnection | null = null;
  try {
    connection = createDatabase(databasePath);
    if (!connection.checkDatabaseConnection()) {
      throw new Error('A consulta de validação SELECT 1 não retornou o resultado esperado.');
    }
    runMigrations(connection.db, migrationsPath);
    sharedConnection = connection;
    return connection;
  } catch (error) {
    connection?.closeDatabase();
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Não foi possível abrir e migrar o banco SQLite local em ${databasePath}: ${detail}`,
      { cause: error }
    );
  }
}

export function getDatabase(): EasyPollDatabase {
  return initializeDatabase().db;
}

export function getSqliteConnection(): BetterSqlite3.Database {
  return initializeDatabase().sqlite;
}

export function checkDatabaseConnection(): boolean {
  return initializeDatabase().checkDatabaseConnection();
}

export function closeDatabase(): void {
  sharedConnection?.closeDatabase();
  sharedConnection = null;
}

export {
  createDatabase,
  ensureDatabaseDirectory,
  type DatabaseConnection,
  type EasyPollDatabase,
  resolveDefaultDatabasePath
} from './database';
export { resolveMigrationsPath, runMigrations } from './migrate';
