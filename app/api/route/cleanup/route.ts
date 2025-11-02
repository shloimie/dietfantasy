// app/api/route/cleanup/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";

function normalizeDay(raw?: string | null) {
    const s = String(raw ?? "all").toLowerCase().trim();
    const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday","all"];
    return days.includes(s) ? s : "all";
}
function isDeliverable(u: any) {
    const v = (u?.delivery ?? u?.Delivery);
    return v === undefined || v === null ? true : Boolean(v);
}

export async function POST(req: NextRequest) {
    try {
        const day = normalizeDay(new URL(req.url).searchParams.get("day"));
        const dayWhere = { day };

        // Load users (id, paused, delivery flags)
        const users = await prisma.user.findMany({
            select: { id: true, paused: true, delivery: true,},
        });
        const okUserIds = new Set(
            users.filter(u => !u.paused && isDeliverable(u)).map(u => u.id)
        );

        // Delete invalid stops for this day
        const delRes = await prisma.stop.deleteMany({
            where: {
                ...dayWhere,
                OR: [
                    { userId: null },
                    { userId: { notIn: Array.from(okUserIds) } },
                ],
            },
        });

        // Keep a set of existing stop ids for day
        const existingStops = await prisma.stop.findMany({
            where: { ...dayWhere },
            select: { id: true },
        });
        const goodStopIds = new Set(existingStops.map(s => s.id));

        // Scrub drivers' stopIds to only valid stop ids
        const drivers = await prisma.driver.findMany({
            where: { day },
            select: { id: true, stopIds: true },
        });
        let driversPatched = 0;
        for (const d of drivers) {
            const raw = Array.isArray(d.stopIds) ? d.stopIds : [];
            const filtered = raw
                .map((v: any) => Number(v))
                .filter((n: any) => Number.isFinite(n) && goodStopIds.has(n));
            const changed = filtered.length !== raw.length;
            if (changed) {
                await prisma.driver.update({
                    where: { id: d.id },
                    data: { stopIds: filtered as any },
                });
                driversPatched++;
            }
        }

        // Clear assignedDriverId for any stop pointing to a non-existent driver (paranoia)
        const driverIds = new Set((await prisma.driver.findMany({ where: { day }, select: { id: true } })).map(d => d.id));
        const orphanStops = await prisma.stop.findMany({
            where: {
                ...dayWhere,
                assignedDriverId: { not: null },
            },
            select: { id: true, assignedDriverId: true },
        });
        const toClear = orphanStops.filter(s => !driverIds.has(Number(s.assignedDriverId)));
        if (toClear.length) {
            await prisma.stop.updateMany({
                where: { id: { in: toClear.map(s => s.id) } },
                data: { assignedDriverId: null, order: null },
            });
        }

        return NextResponse.json({
            ok: true,
            day,
            removedStops: delRes.count,
            driversPatched,
            clearedAssignments: toClear.length || 0,
        });
    } catch (e: any) {
        console.error("[/api/route/cleanup] Error:", e);
        return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
    }
}