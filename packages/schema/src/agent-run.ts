import z from "zod";

/** Ordinary union: answering and dismissing a question share the same type. */
export const runReplySchema = z.union([
  z
    .object({ type: z.literal("permission"), response: z.enum(["once", "always", "reject"]) })
    .strict(),
  z
    .object({
      type: z.literal("question"),
      answers: z.record(z.string().max(255), z.array(z.string().max(10_000)).min(1).max(50)),
    })
    .strict(),
  z.object({ type: z.literal("question"), reject: z.literal(true) }).strict(),
]);
