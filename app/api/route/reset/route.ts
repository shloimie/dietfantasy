// app/api/route/reset/route.ts
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
const prisma = new PrismaClient();

/** Safely coerce Prisma.JsonValue -> number[] */
function jsonToNumberArray(val: Prisma.JsonValue | null | undefined): number[] {
    if (!Array.isArray(val)) return [];
    return (val as Prisma.JsonArray)
        .map((v) => (v == null ? NaN : Number(v as any)))
        .filter((n) => Number.isFinite(n)) as number[];
}

/**
 * POST /api/route/reset
 * body:
 *   - driverId?: number   // preferred with your UI
 *   - routeId?: number    // if you use Route.stopIds somewhere else
 *   - day?: string|"all"  // optional; "all" or omitted = no day filter
 *   - clearProof?: boolean // also null-out proofUrl
 *
 * Strategy:
 * 1) Gather target stop IDs from Driver.stopIds (or Route.stopIds).
 * 2) Update all those IDs.
 * 3) ALSO update any rows with assignedDriverId=driverId (safety net).
 */
export async function POST(req: NextRequest) {
    try {
        const { driverId, routeId, day, clearProof } = await req.json();

        if (!driverId && !routeId) {
            return NextResponse.json({ error: "Provide driverId or routeId" }, { status: 400 });
        }

        const dayNorm =
            typeof day === "string" && day.toLowerCase() !== "all"
                ? day.toLowerCase()
                : undefined;

        // Collect target IDs from stopIds list
        let listIds: number[] = [];
        if (driverId) {
            const d = await prisma.driver.findUnique({
                where: { id: Number(driverId) },
                select: { stopIds: true },
            });
            listIds = jsonToNumberArray(d?.stopIds);
        } else if (routeId) {
            const r = await prisma.route.findUnique({
                where: { id: Number(routeId) },
                select: { stopIds: true },
            });
            listIds = jsonToNumberArray(r?.stopIds);
        }

        const data: { completed: boolean; proofUrl?: null } = { completed: false };
        if (clearProof) data.proofUrl = null;

        let totalUpdated = 0;

        // (A) Update by explicit list IDs (what your drivers page really uses)
        if (listIds.length) {
            const whereA: any = { id: { in: listIds } };
            if (dayNorm) whereA.day = dayNorm;
            const resA = await prisma.stop.updateMany({ where: whereA, data });
            totalUpdated += resA.count;
        }

        // (B) Safety net: update any rows with assignedDriverId=driverId
        // (covers cases where stopIds are out-of-sync)
        if (driverId) {
            const whereB: any = { assignedDriverId: Number(driverId) };
            if (dayNorm) whereB.day = dayNorm;
            const resB = await prisma.stop.updateMany({ where: whereB, data });
            totalUpdated += resB.count;
        }

        return NextResponse.json({ ok: true, updated: totalUpdated });
    } catch (err) {
        console.error("[/api/route/reset] Error:", err);
        return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
}