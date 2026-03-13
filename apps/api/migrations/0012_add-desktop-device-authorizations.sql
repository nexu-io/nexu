CREATE TABLE "desktop_device_authorizations" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"device_id" text NOT NULL,
	"device_secret_hash" text NOT NULL,
	"user_id" text,
	"encrypted_api_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "desktop_device_authorizations_id_unique" UNIQUE("id"),
	CONSTRAINT "desktop_device_authorizations_device_id_unique" UNIQUE("device_id")
);
--> statement-breakpoint
CREATE INDEX "desktop_device_auth_device_id_idx" ON "desktop_device_authorizations" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "desktop_device_auth_status_idx" ON "desktop_device_authorizations" USING btree ("status");