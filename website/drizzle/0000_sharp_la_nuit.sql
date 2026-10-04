CREATE TABLE `ai_requests` (
	`request_id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`day` text NOT NULL,
	`created_at` integer NOT NULL,
	`status` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer
);
--> statement-breakpoint
CREATE INDEX `idx_ai_requests_day_actor` ON `ai_requests` (`day`,`actor`);--> statement-breakpoint
CREATE INDEX `idx_ai_requests_actor_created` ON `ai_requests` (`actor`,`created_at`);