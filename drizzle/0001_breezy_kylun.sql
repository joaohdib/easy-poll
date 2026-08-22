ALTER TABLE `poll_options` ADD `whatsapp_local_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `poll_options_poll_id_whatsapp_local_id_unique` ON `poll_options` (`poll_id`,`whatsapp_local_id`);