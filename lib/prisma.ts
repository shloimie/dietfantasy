try {
    const url = new URL(process.env.DATABASE_URL || '');
    console.log('DB host:port ->', url.host);
    console.log('pgbouncer:', url.searchParams.get('pgbouncer'), 'sslmode:', url.searchParams.get('sslmode'));
    console.log('PRISMA_DISABLE_PREPARED_STATEMENTS ->', process.env.PRISMA_DISABLE_PREPARED_STATEMENTS);
} catch { console.log('DATABASE_URL missing or malformed'); }

import { PrismaClient } from '@prisma/client';
const g = global as unknown as { prisma?: PrismaClient };

export const prisma = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') g.prisma = prisma;

export default prisma;