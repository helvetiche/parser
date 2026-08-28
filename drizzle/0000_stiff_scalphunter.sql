CREATE TABLE `candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`summary` text DEFAULT 'N/A' NOT NULL,
	`education` text DEFAULT 'N/A' NOT NULL,
	`experience` text DEFAULT '[]' NOT NULL,
	`skills` text DEFAULT '[]' NOT NULL,
	`expected_salary` text DEFAULT 'N/A' NOT NULL,
	`reasoning` text DEFAULT 'N/A' NOT NULL,
	`contacts` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `candidates_created_at_idx` ON `candidates` (`created_at`);--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`job_title` text NOT NULL,
	`description` text DEFAULT 'N/A' NOT NULL,
	`responsibilities` text DEFAULT '[]' NOT NULL,
	`requirements` text DEFAULT '[]' NOT NULL,
	`skills` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `roles_created_at_idx` ON `roles` (`created_at`);--> statement-breakpoint
CREATE TABLE `prompts` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`prompt` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `prompts_created_at_idx` ON `prompts` (`created_at`);--> statement-breakpoint
CREATE TABLE `role_evaluations` (
	`role_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`candidate_name` text NOT NULL,
	`evaluated_at` text NOT NULL,
	`score` integer NOT NULL,
	`verdict` text NOT NULL,
	`current_job` text DEFAULT 'N/A' NOT NULL,
	`open_to_work` integer DEFAULT false NOT NULL,
	`matched_skills` text DEFAULT '[]' NOT NULL,
	`missing_skills` text DEFAULT '[]' NOT NULL,
	`tool_experience` text DEFAULT '[]' NOT NULL,
	`met_requirements` text DEFAULT '[]' NOT NULL,
	`reasoning` text DEFAULT 'N/A' NOT NULL,
	PRIMARY KEY(`role_id`, `candidate_id`),
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `role_evaluations_role_idx` ON `role_evaluations` (`role_id`);--> statement-breakpoint
CREATE INDEX `role_evaluations_candidate_idx` ON `role_evaluations` (`candidate_id`);--> statement-breakpoint
CREATE TABLE `role_endorsements` (
	`role_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`candidate_name` text NOT NULL,
	`status` text NOT NULL,
	`added_at` text NOT NULL,
	PRIMARY KEY(`role_id`, `candidate_id`),
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `role_endorsements_role_idx` ON `role_endorsements` (`role_id`);--> statement-breakpoint
CREATE INDEX `role_endorsements_candidate_idx` ON `role_endorsements` (`candidate_id`);
