CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `poll_options` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`poll_id` text NOT NULL,
	`text` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`poll_id`) REFERENCES `polls`(`message_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `poll_options_poll_id_position_unique` ON `poll_options` (`poll_id`,`position`);--> statement-breakpoint
CREATE TABLE `poll_votes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`poll_id` text NOT NULL,
	`voter_id` text NOT NULL,
	`option_id` integer NOT NULL,
	`voted_at` integer,
	FOREIGN KEY (`poll_id`) REFERENCES `polls`(`message_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`voter_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`option_id`) REFERENCES `poll_options`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `poll_votes_poll_id_voter_id_option_id_unique` ON `poll_votes` (`poll_id`,`voter_id`,`option_id`);--> statement-breakpoint
CREATE INDEX `poll_votes_voter_id_poll_id_idx` ON `poll_votes` (`voter_id`,`poll_id`);--> statement-breakpoint
CREATE TABLE `polls` (
	`message_id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`creator_id` text,
	`question` text NOT NULL,
	`created_at` integer NOT NULL,
	`allow_multiple_answers` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`creator_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `polls_group_id_created_at_idx` ON `polls` (`group_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `processed_messages` (
	`message_id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`message_type` text NOT NULL,
	`message_timestamp` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `processed_messages_group_id_message_timestamp_idx` ON `processed_messages` (`group_id`,`message_timestamp`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`group_id` text PRIMARY KEY NOT NULL,
	`last_sync_at` integer,
	`oldest_processed_timestamp` integer,
	`newest_processed_timestamp` integer,
	`messages_processed` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
