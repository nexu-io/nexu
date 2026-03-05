CREATE TABLE "workspace_template_snapshots" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"version" integer NOT NULL,
	"templates_hash" text NOT NULL,
	"templates_json" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "workspace_template_snapshots_id_unique" UNIQUE("id"),
	CONSTRAINT "workspace_template_snapshots_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "workspace_templates" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"content" text NOT NULL,
	"write_mode" text DEFAULT 'seed' NOT NULL,
	"status" text DEFAULT 'active',
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "workspace_templates_id_unique" UNIQUE("id"),
	CONSTRAINT "workspace_templates_name_unique" UNIQUE("name")
);
