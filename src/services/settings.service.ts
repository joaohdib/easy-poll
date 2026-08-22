import { statSync } from 'node:fs';
import path from 'node:path';
import {
  SettingsRepository,
  type DeletedAllData,
  type DeletedGroupData,
  type LocalDataSummaryRows
} from '../repositories/settings.repository';

export interface SettingsStorageSummary extends LocalDataSummaryRows {
  database: {
    fileName: string;
    relativePath: string;
    sizeBytes: number;
  };
}

export class SettingsService {
  constructor(
    private readonly repository: SettingsRepository,
    private readonly databasePath: string
  ) {}

  getStorageSummary(): SettingsStorageSummary {
    const fileName = this.databasePath === ':memory:'
      ? 'easypoll.db'
      : path.basename(this.databasePath);
    return {
      database: {
        fileName,
        relativePath: path.posix.join('data', fileName),
        sizeBytes: calculateSqliteStorageSize(this.databasePath)
      },
      ...this.repository.loadSummary()
    };
  }

  deleteGroupData(groupId: string): DeletedGroupData | null {
    return this.repository.deleteGroupData(groupId);
  }

  deleteAllData(): DeletedAllData {
    return this.repository.deleteAllData();
  }
}

export function calculateSqliteStorageSize(databasePath: string): number {
  if (databasePath === ':memory:') return 0;
  return [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]
    .reduce((total, filePath) => total + fileSizeOrZero(filePath), 0);
}

function fileSizeOrZero(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch (error) {
    if (isMissingFileError(error)) return 0;
    throw error;
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
