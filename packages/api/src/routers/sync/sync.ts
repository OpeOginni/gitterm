import z from "zod";
import { cliAuthProcedure, router } from "../..";
import { getProjectChunksDir, getProjectSessionDir, uploadChunk } from "../../service/sst/blob-storage";
import { db, eq, and } from "@gitterm/db";
import { syncManifest, syncProject } from "@gitterm/db/schema/sync";
import { cliJWT } from "../../service/tunnel/cli-jwt";
import { TRPCError } from "@trpc/server";
import { sqliteDb } from "@gitterm/sync-sqlite";
import { MessageTable, TodoTable, PartTable, SessionTable } from "@gitterm/sync-sqlite/schema/session";
import { SessionShareTable, ShareTable } from "@gitterm/sync-sqlite/schema/share";

export const syncRouter = router({
    getSyncedProjectCurrentSnapshot: cliAuthProcedure.input(
        z.object({
            projectId: z.string(),
        })
    ).query(async ({ input, ctx }) => {
        const { projectId } = input;
        const { cliAuth } = ctx;

        if(!cliJWT.hasScope(cliAuth, "tunnel:sync:*")) {
            throw new TRPCError({
                code: "UNAUTHORIZED",
                message: "Unauthorized",
            });
        }
        const userId = cliAuth.userId;

        const [syncedProject] = await db.select().from(syncProject).where(and(eq(syncProject.userId, userId), eq(syncProject.projectId, projectId))).limit(1);

        if (!syncedProject) {
            return {
                success: true,
                currentSnapshot: null,
            }
        }

        return {
            success: true,
            currentSnapshot: syncedProject.currentSnapshot,
        }
    }),
    syncProject: cliAuthProcedure.input(
        z.object({
            projectId: z.string(),
            manifest: z.object({
                snapshot: z.string(),
                createdAt: z.number(),
                parentSnapshot: z.string().optional(),
                files: z.record(z.string(), z.object({ size: z.number(), chunks: z.array(z.string()) }))
            }),
            chunks: z.array(z.object({ 
                hash: z.string(), data: z.instanceof(Uint8Array) 
            })),
            messages: z.array(z.any()),
            parts: z.array(z.any()),
            todos: z.array(z.any()),
            sessionShares: z.array(z.any()),
            shares: z.array(z.any()),
            sessions: z.array(z.any()),
        })
    ).mutation(async ({ input, ctx }) => {
        const { projectId, manifest, chunks, messages, parts, todos, sessionShares, shares, sessions } = input;
        const { cliAuth } = ctx;

        if(!cliJWT.hasScope(cliAuth, "tunnel:sync:*")) {
            throw new TRPCError({
                code: "UNAUTHORIZED",
                message: "Unauthorized",
            });
        }
        const userId = cliAuth.userId;

        const [syncedProject] = await db.insert(syncProject).values({
            projectId,
            userId: userId,
            blobSessionsDir: getProjectSessionDir(userId, projectId),
            blobChunksDir: getProjectChunksDir(userId, projectId),
            currentSnapshot: manifest.snapshot,
            createdAt: new Date(),
            updatedAt: new Date(),
        }).onConflictDoUpdate({
            target: [syncProject.userId, syncProject.projectId],
            set: {
                currentSnapshot: manifest.snapshot,
                updatedAt: new Date(),
            },
        }).returning();

        if (!syncedProject) {
            throw new Error("Failed to create synced project");
        }

        const [syncedManifest] = await db.insert(syncManifest).values({
            userId: userId,
            syncProjectId: syncedProject.id,
            snapshot: manifest.snapshot,
            createdAt: new Date(),
            parentSnapshot: manifest.parentSnapshot,
            files: manifest.files,
        }).returning();

        if (!syncedManifest) {
            throw new Error("Failed to create synced manifest");
        }

        for (const chunk of chunks) {
            await uploadChunk(userId, projectId, chunk.hash, chunk.data);
        }

        // Add userId to all inserts - data comes from local DB which doesn't have userId
        const sessionsWithUserId = sessions.map((session: any) => ({ ...session, userId }));
        const messagesWithUserId = messages.map((msg: any) => ({ ...msg, userId }));
        const partsWithUserId = parts.map((part: any) => ({ ...part, userId }));
        const todosWithUserId = todos.map((todo: any) => ({ ...todo, userId }));
        const sessionSharesWithUserId = sessionShares.map((share: any) => ({ ...share, userId }));
        const sharesWithUserId = shares.map((share: any) => ({ ...share, userId }));

        await sqliteDb.insert(SessionTable).values(sessionsWithUserId).onConflictDoNothing();
        await sqliteDb.insert(MessageTable).values(messagesWithUserId).onConflictDoNothing();
        await sqliteDb.insert(PartTable).values(partsWithUserId).onConflictDoNothing();
        await sqliteDb.insert(TodoTable).values(todosWithUserId).onConflictDoNothing();
        await sqliteDb.insert(SessionShareTable).values(sessionSharesWithUserId).onConflictDoNothing();
        await sqliteDb.insert(ShareTable).values(sharesWithUserId).onConflictDoNothing();
 
        return {
            success: true,
            message: "Project synced successfully",
            projectId: syncedProject.id,
            manifestId: syncedManifest.id,
            chunks: chunks.length,
            sessions: sessions.length,
        };
    })
})