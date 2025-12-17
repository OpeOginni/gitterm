import { z } from "zod";

export const tunnelFrameSchema = z.object({
	type: z.enum(["auth", "open", "close", "ping", "pong", "request", "response", "data", "error"]),
	id: z.string(),
	method: z.string().optional(),
	path: z.string().optional(),
	token: z.string().optional(),
	statusCode: z.number().optional(),
	headers: z.record(z.string(), z.string()).optional(),
	length: z.number().optional(),
	stream: z.boolean().optional(),
	final: z.boolean().optional(),
	serviceName: z.string().optional(),
	port: z.number().optional(),
	exposedPorts: z.record(z.string(), z.number()).optional(),
	// For `data` frames, body is base64 encoded for now.
	mainSubdomain: z.string().optional(),
	data: z.string().optional(),
	timestamp: z.number().optional(),
});

export type TunnelFrame = z.infer<typeof tunnelFrameSchema>;
