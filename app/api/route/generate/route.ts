// app/api/route/generate/route.ts
import { NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";
import { planRoutesByAreaBalanced } from "../../../../utils/routing/areaBalance";

const prisma = new PrismaClient();

type Body = { day?: string; driverCount?: number };

function normalizeDay(raw?: string | null) {
    const s = String(raw ?? "all").toLowerCase().trim();
    const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "all"];
    return days.includes(s) ? s : "all";
}

const PALETTE = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"];

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as Body;
        const day = normalizeDay(body.day);
        const k = Math.max(1, Math.min(20, body.driverCount ?? 6));

        // 0) Pull geocoded stops for this day (or all)
        const stops = await prisma.stop.findMany({
            where: { ...(day === "all" ? {} : { day }) },
            select: { id: true, lat: true, lng: true },
        });

        const pts = stops
            .filter((s) => s.lat != null && s.lng != null)
            .map((s) => ({ id: s.id, lat: s.lat as number, lng: s.lng as number }));

        if (!pts.length) {
            return NextResponse.json({ ok: true, routes: [], message: "No geocoded stops." });
        }

        // 1) Build plan (Morton split)
        const plan = planRoutesByAreaBalanced(pts, k);

        // 2) Ensure we have k drivers for this day; satisfy required fields
        const driverWhere = day === "all" ? {} : { day };
        let drivers = await prisma.driver.findMany({ where: driverWhere, orderBy: { id: "asc" } });

        while (drivers.length < k) {
            const idx = drivers.length;
            const created = await prisma.driver.create({
                data: {
                    name: `Driver ${idx + 1}`,
                    color: PALETTE[idx % PALETTE.length],
                    ...(day === "all" ? { day: "all" } : { day }),             // required field
                    stopIds: [] as unknown as Prisma.InputJsonValue,            // required JSON
                },
            });
            drivers.push(created);
        }

        // 3) Clear old assignments for this day AND clear all drivers' stopIds (for that day)
        await prisma.stop.updateMany({
            where: { ...(day === "all" ? {} : { day }) },
            data: { assignedDriverId: null, order: null },
        });

        await prisma.driver.updateMany({
            where: (day === "all") ? {} : { day },
            data: { stopIds: [] as unknown as Prisma.InputJsonValue },
        });

        // 4) Assign stops per driver (batched non-interactive transactions) and rewrite driver.stopIds
        for (let i = 0; i < plan.length; i++) {
            const d = drivers[i];
            const ids = plan[i].stopIds;

            const updates = ids.map((stopId, idx) =>
                prisma.stop.update({
                    where: { id: stopId },
                    data: { assignedDriverId: d.id, order: idx + 1 },
                })
            );

            if (updates.length > 0) {
                await prisma.$transaction(updates, { timeout: 60_000 });
            }

            await prisma.driver.update({
                where: { id: d.id },
                data: { stopIds: ids as unknown as Prisma.InputJsonValue },
            });
        }

        // 5) Zero-out any extra drivers for this day that we didn't use this run
// 5) Remove any extra drivers for this day that were not used
        const usedIds = new Set(drivers.slice(0, plan.length).map((d) => d.id));
        const usedIdsArr = Array.from(usedIds);

// First clear them (in case UI fetches before delete finishes)
        await prisma.driver.updateMany({
            where: {
                ...(day === "all" ? {} : { day }),
                id: { notIn: usedIdsArr },
            },
            data: { stopIds: [] as unknown as Prisma.InputJsonValue },
        });

// Then permanently delete unused drivers
        await prisma.driver.deleteMany({
            where: {
                ...(day === "all" ? {} : { day }),
                id: { notIn: usedIdsArr },
            },
        });

        // 6) Respond
        return NextResponse.json({
            ok: true,
            routes: plan.map((r, i) => ({
                driverId: drivers[i].id,
                driverName: drivers[i].name,
                color: drivers[i].color,
                count: r.count,
                center: r.center,
                stopIds: r.stopIds,
            })),
            message: `Loaded ${plan.length} routes. Stops per driver: [${plan.map((p) => p.count).join(", ")}]`,
        });
    } catch (e: any) {
        console.error("[/api/route/generate] Error:", e);
        return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
    }
}