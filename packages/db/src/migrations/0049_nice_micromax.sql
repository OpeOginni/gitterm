CREATE INDEX "agent_run_status_idx" ON "agent_run" USING btree ("status");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspace_route_access_workspace_port_idx" ON "workspace_route_access" USING btree ("workspace_id","port");--> statement-breakpoint
CREATE INDEX "usage_session_workspace_idx" ON "usage_session" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "usage_session_user_stopped_idx" ON "usage_session" USING btree ("user_id","stopped_at");--> statement-breakpoint
CREATE INDEX "workspace_subdomain_idx" ON "workspace" USING btree ("subdomain");--> statement-breakpoint
CREATE INDEX "workspace_external_instance_idx" ON "workspace" USING btree ("external_instance_id");--> statement-breakpoint
CREATE INDEX "workspace_live_status_idx" ON "workspace" USING btree ("status") WHERE "workspace"."status" <> 'terminated';