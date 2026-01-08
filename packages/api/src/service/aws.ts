// import { db, eq, and } from "@gitterm/db";
// import { cloudAccount, instance, serverType } from "@gitterm/db/schema/cloud";
// import { EC2Client, RunInstancesCommand, TerminateInstancesCommand } from "@aws-sdk/client-ec2";
// import { TRPCError } from "@trpc/server";
// import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";
// import { generateUserData } from "../utils/workspace";

// export async function createInstance(serverTypeId: string, userId: string, repoUrl: string, branch: string = "main") {
//     const [fetchedServerType] = await db.select().from(serverType).where(eq(serverType.id, serverTypeId));

//     if (!fetchedServerType) {
//         throw new TRPCError({ code: "NOT_FOUND", message: "Server type not found" });
//     }

//     const [cloudConfig] = await db.select().from(cloudAccount).where(and(eq(cloudAccount.userId, userId), eq(cloudAccount.providerId, fetchedServerType.cloudProviderId)));

//     if (!cloudConfig) 
//         throw new TRPCError({ code: "NOT_FOUND", message: "Cloud config not found" });
    
//     const sts = new STSClient({ region: 'us-east-1' })


//     const assumed = await sts.send(
//         new AssumeRoleCommand({
//           RoleArn: cloudConfig.roleArn,
//           RoleSessionName: `gitterm-session-${userId}`,
//           ExternalId: cloudConfig.externalId
//         })
//       )

//       if (!assumed.Credentials) 
//         throw new TRPCError({ code: "NOT_FOUND", message: "Credentials not found" });
      
//       if (!assumed.Credentials.AccessKeyId)
//         throw new TRPCError({ code: "NOT_FOUND", message: "Access key ID not found" });

//       if (!assumed.Credentials.SecretAccessKey)
//         throw new TRPCError({ code: "NOT_FOUND", message: "Secret access key not found" });

//       if (!assumed.Credentials.SessionToken)
//         throw new TRPCError({ code: "NOT_FOUND", message: "Session token not found" });

//       const credentials = {
//         accessKeyId: assumed.Credentials.AccessKeyId,
//         secretAccessKey: assumed.Credentials.SecretAccessKey,
//         sessionToken: assumed.Credentials.SessionToken
//       }

//     const ec2 = new EC2Client({
//         credentials,
//         region: cloudConfig.region,
//     })


//     const userData = generateUserData(repoUrl, branch);
    
//     const run = await ec2.send(
//         new RunInstancesCommand({
//           ImageId: "ami-0c02fb55956c7d316", // Ubuntu 22.04 example
//           InstanceType: "t3.micro",
//           MinCount: 1,
//           MaxCount: 1,
//           TagSpecifications: [
//             {
//               ResourceType: "instance",
//               Tags: [
//                 { Key: "Name", Value: "gitterm-agent" },
//                 { Key: "Owner", Value: userId },
//               ],
//             },
//           ],
//           UserData: userData,
//         })
//       )

//     const instanceId = run.Instances?.[0]?.InstanceId ?? null;

//     if (!instanceId)
//         throw new TRPCError({ code: "NOT_FOUND", message: "Instance ID not found" });

//     const [newInstance] = await db.insert(instance).values({
//         instanceId,
//         userId,
//         serverTypeId,
//         status: "pending",
//     }).returning();

//     return newInstance?.id;
// }

// export async function deleteInstance(instanceId: string, userId: string) {
//     const [fetchedInstance] = await db.select().from(instance).where(and(eq(instance.id, instanceId), eq(instance.userId, userId)));

//     if (!fetchedInstance) 
//         throw new TRPCError({ code: "NOT_FOUND", message: "Instance not found" });

//     const [cloudConfig] = await db.select().from(cloudAccount).where(and(eq(cloudAccount.userId, userId), eq(cloudAccount.providerId, fetchedInstance.serverTypeId)));

//     if (!cloudConfig)
//         throw new TRPCError({ code: "NOT_FOUND", message: "Cloud config not found" });

//     const sts = new STSClient({ region: 'us-east-1' })

//     const assumed = await sts.send(
//         new AssumeRoleCommand({
//           RoleArn: cloudConfig.roleArn,
//           RoleSessionName: `gitterm-session-${userId}`,
//           ExternalId: cloudConfig.externalId
//         })
//       )

//       if (!assumed.Credentials) 
//         throw new TRPCError({ code: "NOT_FOUND", message: "Credentials not found" });
      
//       if (!assumed.Credentials.AccessKeyId)
//         throw new TRPCError({ code: "NOT_FOUND", message: "Access key ID not found" });

//       if (!assumed.Credentials.SecretAccessKey)
//         throw new TRPCError({ code: "NOT_FOUND", message: "Secret access key not found" });

//       if (!assumed.Credentials.SessionToken)
//         throw new TRPCError({ code: "NOT_FOUND", message: "Session token not found" });

//       const credentials = {
//         accessKeyId: assumed.Credentials.AccessKeyId,
//         secretAccessKey: assumed.Credentials.SecretAccessKey,
//         sessionToken: assumed.Credentials.SessionToken
//       }

//       const ec2 = new EC2Client({
//         credentials,
//         region: cloudConfig.region,
//     })

//     await ec2.send(new TerminateInstancesCommand({ InstanceIds: [fetchedInstance.instanceId] }));

//     await db.update(instance).set({ status: "terminated" }).where(eq(instance.id, instanceId));

//     return true;
// }