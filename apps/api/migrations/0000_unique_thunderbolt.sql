CREATE TABLE "artifacts" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"bot_id" text NOT NULL,
	"session_key" text,
	"channel_type" text,
	"channel_id" text,
	"title" text NOT NULL,
	"artifact_type" text,
	"source" text,
	"content_type" text,
	"status" text DEFAULT 'building',
	"preview_url" text,
	"deploy_target" text,
	"lines_of_code" integer,
	"file_count" integer,
	"duration_ms" integer,
	"metadata" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "artifacts_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "bot_channels" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"bot_id" text NOT NULL,
	"channel_type" text NOT NULL,
	"account_id" text NOT NULL,
	"status" text DEFAULT 'pending',
	"channel_config" text DEFAULT '{}',
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "bot_channels_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "bots" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"system_prompt" text,
	"model_id" text DEFAULT 'anthropic/claude-sonnet-4',
	"agent_config" text DEFAULT '{}',
	"tools_config" text DEFAULT '{}',
	"status" text DEFAULT 'active',
	"pool_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "bots_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "channel_credentials" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"bot_channel_id" text NOT NULL,
	"credential_type" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "channel_credentials_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "gateway_assignments" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"bot_id" text NOT NULL,
	"pool_id" text NOT NULL,
	"assigned_at" text NOT NULL,
	CONSTRAINT "gateway_assignments_id_unique" UNIQUE("id"),
	CONSTRAINT "gateway_assignments_bot_id_unique" UNIQUE("bot_id")
);
--> statement-breakpoint
CREATE TABLE "gateway_pools" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"pool_name" text NOT NULL,
	"pool_type" text DEFAULT 'shared',
	"max_bots" integer DEFAULT 50,
	"current_bots" integer DEFAULT 0,
	"status" text DEFAULT 'pending',
	"config_version" integer DEFAULT 0,
	"pod_ip" text,
	"last_heartbeat" text,
	"last_seen_version" integer DEFAULT 0,
	"created_at" text NOT NULL,
	CONSTRAINT "gateway_pools_id_unique" UNIQUE("id"),
	CONSTRAINT "gateway_pools_pool_name_unique" UNIQUE("pool_name")
);
--> statement-breakpoint
CREATE TABLE "invite_codes" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"code" text NOT NULL,
	"max_uses" integer DEFAULT 100,
	"used_count" integer DEFAULT 0,
	"created_by" text,
	"expires_at" text,
	"created_at" text NOT NULL,
	CONSTRAINT "invite_codes_id_unique" UNIQUE("id"),
	CONSTRAINT "invite_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"state" text NOT NULL,
	"bot_id" text,
	"user_id" text NOT NULL,
	"expires_at" text NOT NULL,
	"used_at" text,
	"return_to" text,
	"created_at" text NOT NULL,
	CONSTRAINT "oauth_states_id_unique" UNIQUE("id"),
	CONSTRAINT "oauth_states_state_unique" UNIQUE("state")
);
--> statement-breakpoint
CREATE TABLE "pool_config_snapshots" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"pool_id" text NOT NULL,
	"version" integer NOT NULL,
	"config_hash" text NOT NULL,
	"config_json" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "pool_config_snapshots_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "pool_secrets" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"pool_id" text NOT NULL,
	"secret_name" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"scope" text DEFAULT 'pool' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "pool_secrets_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"bot_id" text NOT NULL,
	"session_key" text NOT NULL,
	"channel_type" text,
	"channel_id" text,
	"title" text NOT NULL,
	"status" text DEFAULT 'active',
	"message_count" integer DEFAULT 0,
	"last_message_at" text,
	"metadata" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "sessions_id_unique" UNIQUE("id"),
	CONSTRAINT "sessions_session_key_unique" UNIQUE("session_key")
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"content" text NOT NULL,
	"files" text DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'active',
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "skills_id_unique" UNIQUE("id"),
	CONSTRAINT "skills_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "skills_snapshots" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"version" integer NOT NULL,
	"skills_hash" text NOT NULL,
	"skills_json" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "skills_snapshots_id_unique" UNIQUE("id"),
	CONSTRAINT "skills_snapshots_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "usage_metrics" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"bot_id" text NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"message_count" integer DEFAULT 0,
	"token_count" integer DEFAULT 0,
	"created_at" text NOT NULL,
	CONSTRAINT "usage_metrics_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"auth_user_id" text NOT NULL,
	"plan" text DEFAULT 'free',
	"invite_accepted_at" text,
	"onboarding_role" text,
	"onboarding_company" text,
	"onboarding_use_cases" text,
	"onboarding_referral_source" text,
	"onboarding_referral_detail" text,
	"onboarding_channel_votes" text,
	"onboarding_avatar" text,
	"onboarding_avatar_votes" text,
	"onboarding_completed_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "users_id_unique" UNIQUE("id"),
	CONSTRAINT "users_auth_user_id_unique" UNIQUE("auth_user_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_routes" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"channel_type" text NOT NULL,
	"external_id" text NOT NULL,
	"pool_id" text NOT NULL,
	"bot_channel_id" text NOT NULL,
	"bot_id" text,
	"account_id" text,
	"runtime_url" text,
	"updated_at" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "webhook_routes_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bot_channels_uniq_idx" ON "bot_channels" USING btree ("bot_id","channel_type","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bots_user_slug_idx" ON "bots" USING btree ("user_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "cred_uniq_idx" ON "channel_credentials" USING btree ("bot_channel_id","credential_type");--> statement-breakpoint
CREATE UNIQUE INDEX "pool_config_snapshots_pool_version_idx" ON "pool_config_snapshots" USING btree ("pool_id","version");--> statement-breakpoint
CREATE INDEX "pool_config_snapshots_pool_hash_idx" ON "pool_config_snapshots" USING btree ("pool_id","config_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "pool_secrets_uniq_idx" ON "pool_secrets" USING btree ("pool_id","secret_name");--> statement-breakpoint
CREATE INDEX "sessions_bot_id_idx" ON "sessions" USING btree ("bot_id");--> statement-breakpoint
CREATE INDEX "sessions_status_idx" ON "sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sessions_created_at_idx" ON "sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sessions_channel_type_idx" ON "sessions" USING btree ("channel_type");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_routes_uniq_idx" ON "webhook_routes" USING btree ("channel_type","external_id");