CREATE TABLE "integration_credentials" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"integration_id" text NOT NULL,
	"credential_key" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "integration_credentials_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "supported_toolkits" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text NOT NULL,
	"domain" text NOT NULL,
	"category" text DEFAULT 'office',
	"auth_scheme" text DEFAULT 'oauth2' NOT NULL,
	"auth_fields" text,
	"enabled" boolean DEFAULT true,
	"sort_order" integer DEFAULT 0,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "supported_toolkits_id_unique" UNIQUE("id"),
	CONSTRAINT "supported_toolkits_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "user_integrations" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"user_id" text NOT NULL,
	"toolkit_slug" text NOT NULL,
	"composio_account_id" text,
	"status" text DEFAULT 'pending',
	"oauth_state" text,
	"return_to" text,
	"source" text,
	"connected_at" text,
	"disconnected_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "user_integrations_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "int_cred_uniq_idx" ON "integration_credentials" USING btree ("integration_id","credential_key");--> statement-breakpoint
CREATE UNIQUE INDEX "user_integrations_user_toolkit_idx" ON "user_integrations" USING btree ("user_id","toolkit_slug");--> statement-breakpoint
CREATE INDEX "user_integrations_user_id_idx" ON "user_integrations" USING btree ("user_id");