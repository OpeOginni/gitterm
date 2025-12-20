import z from "zod";
import { protectedProcedure, router } from "../..";
import { TRPCError } from "@trpc/server";
import { db, eq } from "@gitpad/db";
import { feedback } from "@gitpad/db/schema/feedback";
import { user } from "@gitpad/db/schema/auth";
import { sendAdminMessage } from "../../utils/discord";

export const userRouter = router({
    deleteUser: protectedProcedure.mutation(async ({ ctx }) => {
        const userId = ctx.session.user.id;
        if (!userId) {
            throw new TRPCError({ code: "UNAUTHORIZED", message: "User not authenticated" });
        }
        await db.delete(user).where(eq(user.id, userId));
        return { success: true };
    }),

    submitFeedback: protectedProcedure.input(z.object({
        feedback: z.string().min(1),
    })).mutation(async ({ ctx, input }) => {
        const userId = ctx.session.user.id;
        const userEmail = ctx.session.user.email;
        if (!userId) {
            throw new TRPCError({ code: "UNAUTHORIZED", message: "User not authenticated" });
        }

        try {
            sendAdminMessage(`**Feedback submitted by ${userEmail}:**\n\n${input.feedback}`);
        } catch (error) {
            console.error("Failed to send admin message", { error });
        }
        return { success: true };
    }),
})