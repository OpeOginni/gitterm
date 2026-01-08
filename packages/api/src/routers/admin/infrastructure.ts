/**
 * Infrastructure Admin Router
 * 
 * Manages cloud providers, regions, agent types, and images.
 */

import { z } from "zod";
import { adminProcedure, router } from "../..";
import { TRPCError } from "@trpc/server";
import { db, eq } from "@gitterm/db";
import { 
  cloudProvider, 
  region, 
  agentType, 
  image,
  type NewCloudProvider,
  type NewAgentType,
  type NewImage,
} from "@gitterm/db/schema/cloud";

// ============================================================================
// Input Schemas
// ============================================================================

const createCloudProviderSchema = z.object({
  name: z.string().min(1, "Provider name is required"),
});

const updateCloudProviderSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1, "Provider name is required").optional(),
  isEnabled: z.boolean().optional(),
});

const createRegionSchema = z.object({
  cloudProviderId: z.uuid(),
  name: z.string().min(1, "Region name is required"),
  location: z.string().min(1, "Location is required"),
  externalRegionIdentifier: z.string().min(1, "External identifier is required"),
});

const updateRegionSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  externalRegionIdentifier: z.string().min(1).optional(),
  isEnabled: z.boolean().optional(),
});

const createAgentTypeSchema = z.object({
  name: z.string().min(1, "Agent type name is required"),
  serverOnly: z.boolean().default(false),
});

const updateAgentTypeSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).optional(),
  serverOnly: z.boolean().optional(),
  isEnabled: z.boolean().optional(),
});

const createImageSchema = z.object({
  name: z.string().min(1, "Image name is required"),
  imageId: z.string().min(1, "Docker image ID is required"),
  agentTypeId: z.uuid(),
});

const updateImageSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).optional(),
  imageId: z.string().min(1).optional(),
  agentTypeId: z.uuid().optional(),
  isEnabled: z.boolean().optional(),
});

// ============================================================================
// Router
// ============================================================================

export const infrastructureRouter = router({
  // ========================================================================
  // Cloud Providers
  // ========================================================================
  
  listProviders: adminProcedure.query(async () => {
    const providers = await db.query.cloudProvider.findMany({
      with: {
        regions: true,
      },
      orderBy: (provider, { asc }) => [asc(provider.name)],
    });
    return providers;
  }),

  getProvider: adminProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ input }) => {
      const provider = await db.query.cloudProvider.findFirst({
        where: eq(cloudProvider.id, input.id),
        with: {
          regions: true,
        },
      });
      
      if (!provider) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });
      }
      
      return provider;
    }),

  createProvider: adminProcedure
    .input(createCloudProviderSchema)
    .mutation(async ({ input }) => {
      const [newProvider] = await db
        .insert(cloudProvider)
        .values({
          name: input.name,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as NewCloudProvider)
        .returning();
      
      return newProvider;
    }),

  updateProvider: adminProcedure
    .input(updateCloudProviderSchema)
    .mutation(async ({ input }) => {
      const { id, ...updates } = input;
      
      const [updated] = await db
        .update(cloudProvider)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(cloudProvider.id, id))
        .returning();
      
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });
      }
      
      return updated;
    }),

  toggleProvider: adminProcedure
    .input(z.object({ id: z.uuid(), isEnabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const [updated] = await db
        .update(cloudProvider)
        .set({
          isEnabled: input.isEnabled,
          updatedAt: new Date(),
        })
        .where(eq(cloudProvider.id, input.id))
        .returning();
      
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });
      }
      
      return updated;
    }),

  // ========================================================================
  // Regions
  // ========================================================================
  
  listRegions: adminProcedure.query(async () => {
    const regions = await db.query.region.findMany({
      with: {
        cloudProvider: true,
      },
      orderBy: (r, { asc }) => [asc(r.name)],
    });
    return regions;
  }),

  getRegion: adminProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ input }) => {
      const r = await db.query.region.findFirst({
        where: eq(region.id, input.id),
        with: {
          cloudProvider: true,
        },
      });
      
      if (!r) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Region not found" });
      }
      
      return r;
    }),

  createRegion: adminProcedure
    .input(createRegionSchema)
    .mutation(async ({ input }) => {
      // Verify provider exists
      const provider = await db.query.cloudProvider.findFirst({
        where: eq(cloudProvider.id, input.cloudProviderId),
      });
      
      if (!provider) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Cloud provider not found" });
      }
      
      const [newRegion] = await db
        .insert(region)
        .values({
          cloudProviderId: input.cloudProviderId,
          name: input.name,
          location: input.location,
          externalRegionIdentifier: input.externalRegionIdentifier,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      
      return newRegion;
    }),

  updateRegion: adminProcedure
    .input(updateRegionSchema)
    .mutation(async ({ input }) => {
      const { id, ...updates } = input;
      
      const [updated] = await db
        .update(region)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(region.id, id))
        .returning();
      
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Region not found" });
      }
      
      return updated;
    }),

  toggleRegion: adminProcedure
    .input(z.object({ id: z.uuid(), isEnabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const [updated] = await db
        .update(region)
        .set({
          isEnabled: input.isEnabled,
          updatedAt: new Date(),
        })
        .where(eq(region.id, input.id))
        .returning();
      
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Region not found" });
      }
      
      return updated;
    }),

  // ========================================================================
  // Agent Types
  // ========================================================================
  
  listAgentTypes: adminProcedure.query(async () => {
    const types = await db.query.agentType.findMany({
      orderBy: (t, { asc }) => [asc(t.name)],
    });
    return types;
  }),

  getAgentType: adminProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ input }) => {
      const type = await db.query.agentType.findFirst({
        where: eq(agentType.id, input.id),
      });
      
      if (!type) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agent type not found" });
      }
      
      return type;
    }),

  createAgentType: adminProcedure
    .input(createAgentTypeSchema)
    .mutation(async ({ input }) => {
      const [newType] = await db
        .insert(agentType)
        .values({
          name: input.name,
          serverOnly: input.serverOnly,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as NewAgentType)
        .returning();
      
      return newType;
    }),

  updateAgentType: adminProcedure
    .input(updateAgentTypeSchema)
    .mutation(async ({ input }) => {
      const { id, ...updates } = input;
      
      const [updated] = await db
        .update(agentType)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(agentType.id, id))
        .returning();
      
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agent type not found" });
      }
      
      return updated;
    }),

  toggleAgentType: adminProcedure
    .input(z.object({ id: z.uuid(), isEnabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const [updated] = await db
        .update(agentType)
        .set({
          isEnabled: input.isEnabled,
          updatedAt: new Date(),
        })
        .where(eq(agentType.id, input.id))
        .returning();
      
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agent type not found" });
      }
      
      return updated;
    }),

  // ========================================================================
  // Images
  // ========================================================================
  
  listImages: adminProcedure.query(async () => {
    const images = await db.query.image.findMany({
      with: {
        agentType: true,
      },
      orderBy: (i, { asc }) => [asc(i.name)],
    });
    return images;
  }),

  getImage: adminProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ input }) => {
      const img = await db.query.image.findFirst({
        where: eq(image.id, input.id),
        with: {
          agentType: true,
        },
      });
      
      if (!img) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Image not found" });
      }
      
      return img;
    }),

  createImage: adminProcedure
    .input(createImageSchema)
    .mutation(async ({ input }) => {
      // Verify agent type exists
      const type = await db.query.agentType.findFirst({
        where: eq(agentType.id, input.agentTypeId),
      });
      
      if (!type) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agent type not found" });
      }
      
      const [newImage] = await db
        .insert(image)
        .values({
          name: input.name,
          imageId: input.imageId,
          agentTypeId: input.agentTypeId,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as NewImage)
        .returning();
      
      return newImage;
    }),

  updateImage: adminProcedure
    .input(updateImageSchema)
    .mutation(async ({ input }) => {
      const { id, ...updates } = input;
      
      // Verify agent type exists if updating
      if (updates.agentTypeId) {
        const type = await db.query.agentType.findFirst({
          where: eq(agentType.id, updates.agentTypeId),
        });
        
        if (!type) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Agent type not found" });
        }
      }
      
      const [updated] = await db
        .update(image)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(image.id, id))
        .returning();
      
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Image not found" });
      }
      
      return updated;
    }),

  toggleImage: adminProcedure
    .input(z.object({ id: z.uuid(), isEnabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const [updated] = await db
        .update(image)
        .set({
          isEnabled: input.isEnabled,
          updatedAt: new Date(),
        })
        .where(eq(image.id, input.id))
        .returning();
      
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Image not found" });
      }
      
      return updated;
    }),
});
