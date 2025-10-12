import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * POST /api/route/reset
 * body: { driverId: number, day?: string, clearProof?: boolean }
 * If day is omitted, resets all days for that driver.
 */
export async function POST(req: NextRequest) {
    try {
        const { driverId, day, clearProof } = await req.json();

        if (!driverId || typeof driverId !== "number") {
            return NextResponse.json({ error: "driverId (number) required" }, { status: 400 });
        }

        const where: any = { assignedDriverId: driverId };
        if (day && typeof day === "string") where.day = day;

        const data: any = { completed: false };
        if (clearProof) data.proofUrl = null;

        const result = await prisma.stop.updateMany({
            where,
            data,
        });

        return NextResponse.json({ ok: true, updated: result.count });
    } catch (err: any) {
        console.error("[/api/route/reset] Error:", err);
        return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
}