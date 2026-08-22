ALTER TABLE `polls` ADD `votes_snapshot_available` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `polls` ADD `votes_snapshot_at` integer;