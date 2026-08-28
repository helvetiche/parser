PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_role_endorsements` (
	`role_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`candidate_name` text NOT NULL,
	`status` text NOT NULL,
	`added_at` text NOT NULL,
	PRIMARY KEY(`role_id`, `candidate_id`),
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_role_endorsements`("role_id", "candidate_id", "candidate_name", "status", "added_at") SELECT "role_id", "candidate_id", "candidate_name", "status", "added_at" FROM `role_endorsements`;--> statement-breakpoint
DROP TABLE `role_endorsements`;--> statement-breakpoint
ALTER TABLE `__new_role_endorsements` RENAME TO `role_endorsements`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `role_endorsements_role_idx` ON `role_endorsements` (`role_id`);--> statement-breakpoint
CREATE INDEX `role_endorsements_candidate_idx` ON `role_endorsements` (`candidate_id`);--> statement-breakpoint
CREATE TABLE `__new_role_evaluations` (
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
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_role_evaluations`("role_id", "candidate_id", "candidate_name", "evaluated_at", "score", "verdict", "current_job", "open_to_work", "matched_skills", "missing_skills", "tool_experience", "met_requirements", "reasoning") SELECT "role_id", "candidate_id", "candidate_name", "evaluated_at", "score", "verdict", "current_job", "open_to_work", "matched_skills", "missing_skills", "tool_experience", "met_requirements", "reasoning" FROM `role_evaluations`;--> statement-breakpoint
DROP TABLE `role_evaluations`;--> statement-breakpoint
ALTER TABLE `__new_role_evaluations` RENAME TO `role_evaluations`;--> statement-breakpoint
CREATE INDEX `role_evaluations_role_idx` ON `role_evaluations` (`role_id`);--> statement-breakpoint
CREATE INDEX `role_evaluations_candidate_idx` ON `role_evaluations` (`candidate_id`);