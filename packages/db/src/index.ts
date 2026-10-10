import { PrismaClient } from "@prisma/client";
export * from "@prisma/client";

// Singleton: avoids exhausting DB connections during dev hot-reloads.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ log: ["error"] });
globalForPrisma.prisma = prisma;
