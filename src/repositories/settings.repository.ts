import type BetterSqlite3 from 'better-sqlite3';

export interface LocalDataTotals {
  groups: number;
  polls: number;
  participations: number;
  selections: number;
  processedMessages: number;
}

export interface StoredGroupSummary {
  id: string;
  name: string;
  polls: number;
  participations: number;
  selections: number;
  processedMessages: number;
  lastSyncAt: number | null;
  oldestProcessedTimestamp: number | null;
  newestProcessedTimestamp: number | null;
}

export interface LocalDataSummaryRows {
  totals: LocalDataTotals;
  groups: StoredGroupSummary[];
}

export interface DeletedGroupData {
  deleted: true;
  groupId: string;
  removed: Omit<LocalDataTotals, 'groups'>;
}

export interface DeletedAllData {
  deleted: true;
  removed: LocalDataTotals;
}

const TOTALS_SQL = `
  SELECT
    (SELECT COUNT(*) FROM groups) AS groups,
    (SELECT COUNT(*) FROM polls) AS polls,
    (SELECT COUNT(*) FROM (
      SELECT poll_id, voter_id FROM poll_votes GROUP BY poll_id, voter_id
    )) AS participations,
    (SELECT COUNT(*) FROM poll_votes) AS selections,
    (SELECT COUNT(*) FROM processed_messages) AS processedMessages
`;

const GROUP_SUMMARY_SQL = `
  WITH
    poll_counts AS (
      SELECT group_id, COUNT(*) AS polls
      FROM polls
      GROUP BY group_id
    ),
    selection_counts AS (
      SELECT p.group_id, COUNT(v.id) AS selections
      FROM polls p
      INNER JOIN poll_votes v ON v.poll_id = p.message_id
      GROUP BY p.group_id
    ),
    participation_counts AS (
      SELECT group_id, COUNT(*) AS participations
      FROM (
        SELECT p.group_id, v.poll_id, v.voter_id
        FROM polls p
        INNER JOIN poll_votes v ON v.poll_id = p.message_id
        GROUP BY p.group_id, v.poll_id, v.voter_id
      )
      GROUP BY group_id
    ),
    processed_counts AS (
      SELECT group_id, COUNT(*) AS processed_messages
      FROM processed_messages
      GROUP BY group_id
    )
  SELECT
    g.id,
    g.name,
    COALESCE(pc.polls, 0) AS polls,
    COALESCE(vc.participations, 0) AS participations,
    COALESCE(sc.selections, 0) AS selections,
    COALESCE(mc.processed_messages, 0) AS processedMessages,
    ss.last_sync_at AS lastSyncAt,
    ss.oldest_processed_timestamp AS oldestProcessedTimestamp,
    ss.newest_processed_timestamp AS newestProcessedTimestamp
  FROM groups g
  LEFT JOIN poll_counts pc ON pc.group_id = g.id
  LEFT JOIN participation_counts vc ON vc.group_id = g.id
  LEFT JOIN selection_counts sc ON sc.group_id = g.id
  LEFT JOIN processed_counts mc ON mc.group_id = g.id
  LEFT JOIN sync_state ss ON ss.group_id = g.id
`;

export class SettingsRepository {
  constructor(private readonly sqlite: BetterSqlite3.Database) {}

  loadSummary(): LocalDataSummaryRows {
    return {
      totals: readTotals(this.sqlite),
      groups: this.sqlite.prepare(`${GROUP_SUMMARY_SQL} ORDER BY g.name COLLATE NOCASE, g.id`).all()
        .map(normalizeGroupSummary)
    };
  }

  deleteGroupData(groupId: string): DeletedGroupData | null {
    return this.sqlite.transaction(() => {
      const row = this.sqlite.prepare(`${GROUP_SUMMARY_SQL} WHERE g.id = ?`).get(groupId);
      if (!row) return null;
      const summary = normalizeGroupSummary(row);

      this.sqlite.prepare('DELETE FROM groups WHERE id = ?').run(groupId);
      this.deleteOrphanMembers();

      return {
        deleted: true as const,
        groupId,
        removed: {
          polls: summary.polls,
          participations: summary.participations,
          selections: summary.selections,
          processedMessages: summary.processedMessages
        }
      };
    })();
  }

  deleteAllData(): DeletedAllData {
    return this.sqlite.transaction(() => {
      const removed = readTotals(this.sqlite);
      this.sqlite.prepare('DELETE FROM groups').run();
      this.sqlite.prepare('DELETE FROM members').run();
      return { deleted: true as const, removed };
    })();
  }

  private deleteOrphanMembers(): void {
    this.sqlite.prepare(`
      DELETE FROM members
      WHERE NOT EXISTS (
        SELECT 1 FROM polls WHERE polls.creator_id = members.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM poll_votes WHERE poll_votes.voter_id = members.id
      )
    `).run();
  }
}

function readTotals(sqlite: BetterSqlite3.Database): LocalDataTotals {
  const row = sqlite.prepare(TOTALS_SQL).get() as Record<string, unknown>;
  return {
    groups: toCount(row.groups),
    polls: toCount(row.polls),
    participations: toCount(row.participations),
    selections: toCount(row.selections),
    processedMessages: toCount(row.processedMessages)
  };
}

function normalizeGroupSummary(value: unknown): StoredGroupSummary {
  const row = value as Record<string, unknown>;
  return {
    id: String(row.id),
    name: String(row.name),
    polls: toCount(row.polls),
    participations: toCount(row.participations),
    selections: toCount(row.selections),
    processedMessages: toCount(row.processedMessages),
    lastSyncAt: toNullableNumber(row.lastSyncAt),
    oldestProcessedTimestamp: toNullableNumber(row.oldestProcessedTimestamp),
    newestProcessedTimestamp: toNullableNumber(row.newestProcessedTimestamp)
  };
}

function toCount(value: unknown): number {
  return Number(value) || 0;
}

function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
