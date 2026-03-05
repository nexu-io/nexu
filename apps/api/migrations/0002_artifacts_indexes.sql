CREATE INDEX IF NOT EXISTS "artifacts_bot_id_idx" ON "artifacts" USING btree ("bot_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artifacts_session_key_idx" ON "artifacts" USING btree ("session_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artifacts_status_idx" ON "artifacts" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artifacts_created_at_idx" ON "artifacts" USING btree ("created_at");
