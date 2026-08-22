import { eq } from 'drizzle-orm';
import type { Group } from '../domain/types';
import type { EasyPollDatabase } from '../db/database';
import { groups } from '../db/schema';

export class GroupRepository {
  constructor(private readonly db: EasyPollDatabase) {}

  upsert(group: Group): void {
    this.db.insert(groups).values(group).onConflictDoUpdate({
      target: groups.id,
      set: { name: group.name }
    }).run();
  }

  findById(id: string) {
    return this.db.select().from(groups).where(eq(groups.id, id)).get() || null;
  }
}
