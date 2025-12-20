import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";

dotenv.config({
	// path: "../../apps/server/.env",
	path: "../../apps/server/.env.development.local",
});

export default defineConfig({
	schema: "./src/schema",
	out: "./src/migrations",
	dialect: "postgresql",
	dbCredentials: {
		url: process.env.DATABASE_URL || "",
	},
});
