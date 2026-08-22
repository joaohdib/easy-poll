import { eq } from 'drizzle-orm';
import type { EasyPollDatabase } from '../db/database';
import { members } from '../db/schema';

export interface MemberUpsert {
  id: string;
  displayName: string | null;
}

export class MemberRepository {
  constructor(private readonly db: EasyPollDatabase) {}

  upsertMany(candidates: MemberUpsert[]): void {
    const uniqueMembers = new Map<string, string | null>();
    candidates.forEach((candidate) => {
      if (!candidate.id) return;
      const previous = uniqueMembers.get(candidate.id) || null;
      uniqueMembers.set(candidate.id, candidate.displayName || previous);
    });

    uniqueMembers.forEach((displayName, id) => this.upsert({ id, displayName }));
  }

  upsert(candidate: MemberUpsert): void {
    const displayName = candidate.displayName || maskMemberId(candidate.id);
    const insert = this.db.insert(members).values({ id: candidate.id, displayName });
    if (candidate.displayName) {
      insert.onConflictDoUpdate({
        target: members.id,
        set: { displayName: candidate.displayName }
      }).run();
      return;
    }
    insert.onConflictDoNothing({ target: members.id }).run();
  }

  findById(id: string) {
    return this.db.select().from(members).where(eq(members.id, id)).get() || null;
  }
}

function maskMemberId(id: string): string {
  const localPart = id.split('@')[0];
  const suffix = localPart.length <= 4 ? localPart : localPart.slice(-4);
  return `Participante ••••${suffix}`;
}
