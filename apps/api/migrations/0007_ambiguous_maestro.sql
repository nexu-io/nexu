ALTER TABLE "user_integrations" ADD COLUMN IF NOT EXISTS "return_to" text;--> statement-breakpoint
ALTER TABLE "user_integrations" ADD COLUMN IF NOT EXISTS "source" text;
