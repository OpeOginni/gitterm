ALTER TABLE "user" ALTER COLUMN "plan" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "plan" SET DEFAULT 'free'::text;--> statement-breakpoint
DROP TYPE "public"."user_plan";--> statement-breakpoint
CREATE TYPE "public"."user_plan" AS ENUM('free', 'starter', 'pro');--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "plan" SET DEFAULT 'free'::"public"."user_plan";--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "plan" SET DATA TYPE "public"."user_plan" USING "plan"::"public"."user_plan";