import path from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { EasyPollDatabase } from './database';

export function resolveMigrationsPath(moduleDirectory = __dirname): string {
  const projectRoot = path.resolve(moduleDirectory, '..', '..');
  return path.join(projectRoot, 'drizzle');
}

export function runMigrations(
  db: EasyPollDatabase,
  migrationsFolder = resolveMigrationsPath()
): void {
  migrate(db, { migrationsFolder: path.resolve(migrationsFolder) });
}
