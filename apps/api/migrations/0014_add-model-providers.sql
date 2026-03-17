CREATE TABLE IF NOT EXISTS "model_providers" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"provider_id" text NOT NULL,
	"display_name" text NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"base_url" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"models_json" text DEFAULT '[]' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "model_providers_id_unique" UNIQUE("id"),
	CONSTRAINT "model_providers_provider_id_unique" UNIQUE("provider_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_providers_provider_id_idx" ON "model_providers" USING btree ("provider_id");
