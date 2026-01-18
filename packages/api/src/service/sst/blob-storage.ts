import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import env from "@gitterm/env/server";

const client = new S3Client({
    credentials: {
        accessKeyId: env.CLOUDFLARE_ACCESS_KEY_ID!,
        secretAccessKey: env.CLOUDFLARE_SECRET_ACCESS_KEY!,
    },
    region: "auto",
    endpoint: `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
});

const bucket = env.CLOUDFLARE_BUCKET_NAME!;

export const getProjectSessionDir = (userId: string, projectId: string) => {
    return `users/${userId}/projects/${projectId}/sessions`;
}

export const getProjectSessionFile = (userId: string, projectId: string, sessionId: string) => {
    return `users/${userId}/projects/${projectId}/sessions/${sessionId}`;
}

export const getProjectChunksDir = (userId: string, projectId: string) => {
    return `users/${userId}/projects/${projectId}/chunks`;
}

export const getProjectChunksFile = (userId: string, projectId: string, hash: string) => {
    return `users/${userId}/projects/${projectId}/chunks/${hash}`;
}

export async function uploadChunk(userId: string, projectId: string, hash: string, data: Uint8Array) {
    const command = new PutObjectCommand({
        Bucket: bucket,
        Key: getProjectChunksFile(userId, projectId, hash),
        Body: data,
    });

    await client.send(command);

    return hash;
}

export async function uploadSession(userId: string, projectId: string, sessionId: string, session: File) {
    const command = new PutObjectCommand({
        Bucket: bucket,
        Key: getProjectSessionFile(userId, projectId, sessionId),
        Body: session,
    });

    await client.send(command);
}

export async function generateUploadUrl(key: string) {
    const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: "application/json",
    });

    const url = await getSignedUrl(client, command, {
        expiresIn: 60 * 60, // 1 hour
    });

    return url;
}

export async function generateDownloadUrl(key: string, expiresIn: number = 60 * 60) {
    const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
    });

    const url = await getSignedUrl(client, command, {
        expiresIn,
    });

    return url;
}

/**
 * List all objects in a folder (prefix) and generate download URLs for each
 * @param prefix - Folder path prefix (e.g., "workspaces/abc123/chunks/")
 * @param expiresIn - URL expiration time in seconds (default: 1 hour)
 * @returns Array of { key, url } objects
 */
export async function generateFolderDownloadUrls(
    prefix: string,
    expiresIn: number = 60 * 60,
): Promise<Array<{ key: string; url: string }>> {
    const objects: Array<{ key: string; url: string }> = [];
    let continuationToken: string | undefined;

    do {
        const command = new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
        });

        const response = await client.send(command);

        if (response.Contents) {
            for (const object of response.Contents) {
                if (object.Key) {
                    const url = await generateDownloadUrl(object.Key, expiresIn);
                    objects.push({ key: object.Key, url });
                }
            }
        }

        continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return objects;
}

/**
 * Get download URLs for multiple specific keys
 * @param keys - Array of object keys to generate URLs for
 * @param expiresIn - URL expiration time in seconds (default: 1 hour)
 * @returns Array of { key, url } objects
 */
export async function generateBatchDownloadUrls(
    keys: string[],
    expiresIn: number = 60 * 60,
): Promise<Array<{ key: string; url: string }>> {
    return Promise.all(
        keys.map(async (key) => ({
            key,
            url: await generateDownloadUrl(key, expiresIn),
        })),
    );
}