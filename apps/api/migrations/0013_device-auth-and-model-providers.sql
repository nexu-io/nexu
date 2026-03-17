CREATE TABLE "device_authorizations" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"device_id" text NOT NULL,
	"device_secret_hash" text NOT NULL,
	"user_id" text,
	"encrypted_api_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "device_authorizations_id_unique" UNIQUE("id"),
	CONSTRAINT "device_authorizations_device_id_unique" UNIQUE("device_id")
);--> statement-breakpoint
CREATE INDEX "device_auth_device_id_idx" ON "device_authorizations" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "device_auth_status_idx" ON "device_authorizations" USING btree ("status");
