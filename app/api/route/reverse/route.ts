// app/api/route/reverse/route.ts
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

/** Safely coerce Prisma.JsonValue -> number[] */
function jsonToNumberArray(val: Prisma.JsonValue | null | undefined): number[] {
    if (!Array.isArray(val)) return [];
    return (val as Prisma.JsonArray)
        .map((v) => (v == null ? NaN : Number(v as any)))
        .filter((n) => Number.isFinite(n)) as number[];
}

/** POST { routeId } → reverse Driver.stopIds and Stop.order */
export async function POST(req: NextRequest) {
    try {
        const { routeId } = await req.json();
        const driverId = Number(routeId);
        if (!Number.isFinite(driverId)) {
            return NextResponse.json({ ok: false, error: "routeId required" }, { status: 400 });
        }

        const driver = await prisma.driver.findUnique({
            where: { id: driverId },
            select: { id: true, stopIds: true },
        });
        if (!driver) {
            return NextResponse.json({ ok: false, error: "Driver not found" }, { status: 404 });
        }

        const ids = jsonToNumberArray(driver.stopIds);
        if (!ids.length) {
            return NextResponse.json({ ok: true, stopIds: [] });
        }

        const reversed = [...ids].reverse();

        // Update Stop.order to match reversed order (1..N)
        await prisma.$transaction(
            reversed.map((sid, i) =>
                prisma.stop.update({
                    where: { id: sid },
                    data: { order: i + 1 },
                })
            )
        );

        // Persist reversed stopIds on Driver
        await prisma.driver.update({
            where: { id: driver.id },
            data: { stopIds: reversed as unknown as Prisma.InputJsonValue },
        });

        return NextResponse.json({ ok: true, stopIds: reversed });
    } catch (e: any) {
        console.error("[/api/route/reverse] error", e);
        return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
    }
}