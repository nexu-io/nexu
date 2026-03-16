CREATE TABLE "claim_card_dedup" (
	"event_id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_tokens" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"token" text NOT NULL,
	"workspace_key" text NOT NULL,
	"im_user_id" text NOT NULL,
	"bot_id" text NOT NULL,
	"expires_at" text NOT NULL,
	"used_at" text,
	"used_by_user_id" text,
	"created_at" text NOT NULL,
	CONSTRAINT "claim_tokens_id_unique" UNIQUE("id"),
	CONSTRAINT "claim_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "session_participants" (
	"pk" serial PRIMARY KEY NOT NULL,
	"session_key" text NOT NULL,
	"nexu_user_id" text NOT NULL,
	"im_user_id" text NOT NULL,
	"first_seen_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_memberships" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"workspace_key" text NOT NULL,
	"user_id" text NOT NULL,
	"bot_id" text NOT NULL,
	"im_user_id" text,
	"role" text DEFAULT 'member',
	"created_at" text NOT NULL,
	CONSTRAINT "workspace_memberships_id_unique" UNIQUE("id")
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "nexu_user_id" text;--> statement-breakpoint
ALTER TABLE "bot_channels" ADD COLUMN "connection_mode" text;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "workspace_key" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "nexu_user_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth_source" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth_source_detail" text;--> statement-breakpoint
CREATE UNIQUE INDEX "sp_session_user_idx" ON "session_participants" USING btree ("session_key","nexu_user_id");--> statement-breakpoint
CREATE INDEX "sp_nexu_user_idx" ON "session_participants" USING btree ("nexu_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wm_workspace_user_idx" ON "workspace_memberships" USING btree ("workspace_key","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wm_workspace_im_user_idx" ON "workspace_memberships" USING btree ("workspace_key","im_user_id");--> statement-breakpoint
CREATE INDEX "wm_user_idx" ON "workspace_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "artifacts_nexu_user_id_idx" ON "artifacts" USING btree ("nexu_user_id");--> statement-breakpoint
CREATE INDEX "sessions_nexu_user_id_idx" ON "sessions" USING btree ("nexu_user_id");