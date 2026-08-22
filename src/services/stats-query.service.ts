import type { LocalGroup, PersistedStatsResult } from '../domain/types';
import { StatsRepository } from '../repositories/stats.repository';
import { calculatePollStats } from './stats.service';

export class StatsQueryService {
  constructor(private readonly repository: StatsRepository) {}

  getGroupStats(groupId: string): PersistedStatsResult | null {
    const dataset = this.repository.loadGroupDataset(groupId);
    if (!dataset) return null;
    return {
      stats: calculatePollStats(dataset.analysis),
      localData: dataset.localData
    };
  }

  listLocalGroups(): LocalGroup[] {
    return this.repository.listLocalGroups();
  }
}
