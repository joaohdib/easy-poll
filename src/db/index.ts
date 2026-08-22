import type BetterSqlite3 from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  createDatabase,
  type DatabaseConnection,
  resolveDefaultDatabasePath
} from './database';

export const databasePath = resolveDefaultDatabasePath();

let sharedConnection: DatabaseConnection | null = null;

export function initializeDatabase(): DatabaseConnection {
  if (sharedConnection?.sqlite.open) return sharedConnection;

  let connection: DatabaseConnection | null = null;
  try {
    connection = createDatabase(databasePath);
    if (!connection.checkDatabaseConnection()) {
      throw new Error('A consulta de validação SELECT 1 não retornou o resultado esperado.');
    }
    sharedConnection = connection;
    return connection;
  } catch (error) {
    connection?.closeDatabase();
    throw new Error(`Não foi possível abrir o banco SQLite local em ${databasePath}.`, {
      cause: error
    });
  }
}

export function getDatabase(): BetterSQLite3Database {
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
  resolveDefaultDatabasePath
} from './database';
