// lib/prisma.js
import { PrismaClient } from "@prisma/client";

// Avoid creating multiple clients in dev (hot-reload)
const globalForPrisma = globalThis;

export const prisma =
    globalForPrisma.prisma ??
    new PrismaClient({
        // log: ["query", "error", "warn"],
    });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;