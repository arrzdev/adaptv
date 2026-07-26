CREATE TABLE `documents` (
	`collection` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	`meta` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`seq` integer NOT NULL,
	PRIMARY KEY(`collection`, `id`)
);
--> statement-breakpoint
CREATE INDEX `documents_collection_seq_idx` ON `documents` (`collection`,`seq`);--> statement-breakpoint
CREATE TABLE `sync_counters` (
	`collection` text PRIMARY KEY NOT NULL,
	`value` integer DEFAULT 0 NOT NULL
);
