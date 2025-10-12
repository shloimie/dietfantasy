import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET() {
    // Group signatures by user to get counts
    const rows = await prisma.signature.groupBy({
        by: ["userId"],
        _count: { userId: true },
    });

    // Return as an easy map list
    return NextResponse.json(
        rows.map(r => ({ userId: r.userId, collected: r._count.userId }))
    );
}