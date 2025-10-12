// app/api/route/generate/route.ts
import { NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";
import { planRoutesByAreaBalanced } from "../../../../utils/routing/areaBalance";

const prisma = new PrismaClient();

type Body = { day?: string; driverCount?: number; useDietFantasyStart?: boolean };

function normalizeDay(raw?: string | null) {
    const s = String(raw ?? "all").toLowerCase().trim();
    const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday","all"];
    return days.includes(s) ? s : "all";
}

const PALETTE = ["#1f77b4","#ff7f0e","#2ca02c","#d62728","#9467bd","#8c564b","#e377c2","#7f7f7f","#bcbd22","#17becf"];

// Fixed Diet Fantasy origin
const ORIGIN = { lat: 41.14602684379917, lng: -73.98927105396123 };

function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
    const R = 3958.7613;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function rotateAtIndex<T>(arr: T[], idx: number) {
    if (!arr.length || idx <= 0) return arr.slice();
    return [...arr.slice(idx), ...arr.slice(0, idx)];
}

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as Body;
        const day = normalizeDay(body.day);
        const k = Math.max(1, Math.min(20, body.driverCount ?? 6));
        const useDietFantasyStart = !!body.useDietFantasyStart;

        // 0) Pull geocoded stops for this day (or all)
        const stops = await prisma.stop.findMany({
            where: { ...(day === "all" ? {} : { day }) },
            select: { id: true, lat: true, lng: true },
        });

        const pts = stops
            .filter((s) => s.lat != null && s.lng != null)
            .map((s) => ({ id: s.id, lat: s.lat as number, lng: s.lng as number }));

        if (!pts.length) {
            return NextResponse.json({
                ok: true,
                routes: [],
                appliedStartRotation: false,
                message: "No geocoded stops.",
            });
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
                    ...(day === "all" ? { day: "all" } : { day }),
                    stopIds: [] as unknown as Prisma.InputJsonValue,
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
            where: day === "all" ? {} : { day },
            data: { stopIds: [] as unknown as Prisma.InputJsonValue },
        });

        // 4) Assign stops per driver and rewrite driver.stopIds
        for (let i = 0; i < plan.length; i++) {
            const d = drivers[i];
            const ids = plan[i].stopIds;

            if (ids.length > 0) {
                // Use the callback overload so timeout is allowed
                await prisma.$transaction(
                    async (tx) => {
                        await Promise.all(
                            ids.map((stopId, idx) =>
                                tx.stop.update({
                                    where: { id: stopId },
                                    data: { assignedDriverId: d.id, order: idx + 1 },
                                })
                            )
                        );
                    },
                    { timeout: 60_000 } // valid on callback overload
                );
            }

            await prisma.driver.update({
                where: { id: d.id },
                data: { stopIds: ids as unknown as Prisma.InputJsonValue },
            });
        }

        // 5) Remove any extra drivers for this day that were not used
        const usedIds = new Set(drivers.slice(0, plan.length).map((d) => d.id));
        const usedIdsArr = Array.from(usedIds);

        // First clear them (in case UI fetches before delete finishes)
        await prisma.driver.updateMany({
            where: { ...(day === "all" ? {} : { day }), id: { notIn: usedIdsArr } },
            data: { stopIds: [] as unknown as Prisma.InputJsonValue },
        });

        // Then permanently delete unused drivers
        await prisma.driver.deleteMany({
            where: { ...(day === "all" ? {} : { day }), id: { notIn: usedIdsArr } },
        });

        // 6) If requested, rotate each used route so it starts nearest to Diet Fantasy
        if (useDietFantasyStart) {
            for (let i = 0; i < plan.length; i++) {
                const d = drivers[i];
                if (!d) continue;

                const current = await prisma.driver.findUnique({
                    where: { id: d.id },
                    select: { stopIds: true },
                });

                // Guard + coerce JSON to number[]
                const ids: number[] = Array.isArray(current?.stopIds)
                    ? (current!.stopIds as Array<number | string | null>)
                        .map((v) => (v == null ? NaN : Number(v)))
                        .filter((n) => Number.isFinite(n)) as number[]
                    : [];

                if (!ids.length) continue;

                const stopsForDriver = await prisma.stop.findMany({
                    where: { id: { in: ids } },
                    select: { id: true, lat: true, lng: true },
                });

                const byId = new Map(stopsForDriver.map((s) => [s.id, s]));
                const ordered = ids.map((sid) => byId.get(sid)!).filter(Boolean);

                // find nearest index that has coordinates
                let bestIdx = 0;
                let bestDist = Number.POSITIVE_INFINITY;
                ordered.forEach((s, idx) => {
                    if (typeof s?.lat === "number" && typeof s?.lng === "number") {
                        const dMi = haversineMiles(ORIGIN, { lat: s.lat!, lng: s.lng! });
                        if (dMi < bestDist) {
                            bestDist = dMi;
                            bestIdx = idx;
                        }
                    }
                });

                const rotatedIds = rotateAtIndex(ids, bestIdx);

                // Persist new 1..N Stop.order to match rotatedIds (array overload w/o timeout is fine)
                await prisma.$transaction(
                    rotatedIds.map((sid, j) =>
                        prisma.stop.update({
                            where: { id: sid },
                            data: { order: j + 1 },
                        })
                    )
                );

                // Persist on Driver too
                await prisma.driver.update({
                    where: { id: d.id },
                    data: { stopIds: rotatedIds as unknown as Prisma.InputJsonValue },
                });
            }
        }

        // 7) Respond
        return NextResponse.json({
            ok: true,
            appliedStartRotation: useDietFantasyStart,
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