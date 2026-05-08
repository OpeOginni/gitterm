CREATE TABLE "provider_agent_image" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cloud_provider_id" uuid NOT NULL,
	"agent_type_id" uuid NOT NULL,
	"image_id" uuid NOT NULL,
	"workspace_profile" text,
	"is_default" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_agent_image" ADD CONSTRAINT "provider_agent_image_cloud_provider_id_cloud_provider_id_fk" FOREIGN KEY ("cloud_provider_id") REFERENCES "public"."cloud_provider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_agent_image" ADD CONSTRAINT "provider_agent_image_agent_type_id_agent_type_id_fk" FOREIGN KEY ("agent_type_id") REFERENCES "public"."agent_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_agent_image" ADD CONSTRAINT "provider_agent_image_image_id_image_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."image"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_agent_image_unique" ON "provider_agent_image" USING btree ("cloud_provider_id","agent_type_id",coalesce("workspace_profile", ''));