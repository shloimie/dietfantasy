export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "../../../../lib/prisma";
import { planRoutesByAreaBalanced } from "../../../../utils/routing/areaBalance";


type Body = { day?: string; driverCount?: number; useDietFantasyStart?: boolean };
type DriverLite = { id: number; name: string; color: string; day?: string | null };

function normalizeDay(raw?: string | null) {
    const s = String(raw ?? "all").toLowerCase().trim();
    const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday","all"];
    return days.includes(s) ? s : "all";
}

const PALETTE = ["#1f77b4","#ff7f0e","#2ca02c","#d62728","#9467bd","#8c564b","#e377c2","#7f7f7f","#bcbd22","#17becf"];

// Diet Fantasy origin (miles calc below uses it for rotation)
const ORIGIN = { lat: 41.14628538783947, lng: -73.98948195720195 };

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
        const k = Math.max(1, Math.min(20, body.driverCount ?? 6)); // ACTIVE drivers (excluding Driver 0)
        const useDietFantasyStart = body.useDietFantasyStart !== false; // default true

        // 0) Pull geocoded stops for this day (or all)
        const stops = await prisma.stop.findMany({
            where: { ...(day === "all" ? {} : { day }) },
            select: { id: true, lat: true, lng: true },
            orderBy: { id: "asc" },
        });

        const pts = stops
            .filter((s) => s.lat != null && s.lng != null)
            .map((s) => ({
                id: s.id,
                lat: typeof s.lat === "string" ? parseFloat(s.lat) : (s.lat as number),
                lng: typeof s.lng === "string" ? parseFloat(s.lng) : (s.lng as number),
            }))
            .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

        if (!pts.length) {
            return NextResponse.json({
                ok: true,
                routes: [],
                appliedStartRotation: false,
                origin: ORIGIN,
                message: "No geocoded stops.",
            });
        }

        // Quick lookup map
        const idToPoint = new Map<number, { id:number; lat:number; lng:number }>(pts.map(p => [p.id, p]));

        // 1) Build plan — returns: [ Driver0(outliers), route1..routeK ]
        const plan = planRoutesByAreaBalanced(pts, k);
        if (!Array.isArray(plan) || plan.length === 0) {
            throw new Error("Planner returned no routes.");
        }

        // 1.5) NEW: absorb Driver 0 outliers into nearest active route so no one is “lost”
        //      (Everything geocoded ends up on Driver 1..K.)
        if (plan.length >= 2 && (plan[0]?.stopIds?.length ?? 0) > 0) {
            // compute centers for active routes (fallback to average of member points)
            const centers = plan.slice(1).map((r, idx) => {
                if (r?.center && Number.isFinite(r.center.lat) && Number.isFinite(r.center.lng)) return r.center;
                const ptsIn = (r?.stopIds ?? []).map((sid: number) => idToPoint.get(sid)).filter(Boolean) as {lat:number; lng:number}[];
                if (!ptsIn.length) return { lat: ORIGIN.lat, lng: ORIGIN.lng };
                const lat = ptsIn.reduce((a,p)=>a+p.lat,0)/ptsIn.length;
                const lng = ptsIn.reduce((a,p)=>a+p.lng,0)/ptsIn.length;
                return { lat, lng };
            });

            const transferIds: number[] = plan[0].stopIds ?? [];

            for (const sid of transferIds) {
                const p = idToPoint.get(sid);
                if (!p) continue;
                // choose nearest active center
                let bestI = 0, bestD = Infinity;
                for (let i = 0; i < centers.length; i++) {
                    const d = haversineMiles(p, centers[i]);
                    if (d < bestD) { bestD = d; bestI = i; }
                }
                const destIndexInPlan = bestI + 1; // because plan[1] is Driver 1, etc.
                plan[destIndexInPlan].stopIds = (plan[destIndexInPlan].stopIds ?? []).concat([sid]);
                plan[destIndexInPlan].count = (plan[destIndexInPlan].count ?? 0) + 1;
            }

            // clear Driver 0
            plan[0].stopIds = [];
            plan[0].count = 0;
        }

        // 2) Ensure Driver 0 + Drivers 1..k exist
        const driverWhere = day === "all" ? {} : { day };

        async function ensureDriver(name: string, color: string) {
            const found = await prisma.driver.findFirst({ where: { name, ...(day === "all" ? {} : { day }) } });
            if (found) return found;
            return prisma.driver.create({
                data: {
                    name,
                    color,
                    ...(day === "all" ? { day: "all" } : { day }),
                    stopIds: [] as unknown as Prisma.InputJsonValue,
                },
            });
        }

        const d0Full = await ensureDriver("Driver 0", "#666666");
        const drivers: DriverLite[] = [{ id: d0Full.id, name: d0Full.name, color: d0Full.color, day: d0Full.day }];

        for (let i = 1; i <= k; i++) {
            const name = `Driver ${i}`;
            const existing = await prisma.driver.findFirst({ where: { name, ...(day === "all" ? {} : { day }) } });
            if (existing) {
                drivers.push({ id: existing.id, name: existing.name, color: existing.color, day: existing.day });
            } else {
                const created = await prisma.driver.create({
                    data: {
                        name,
                        color: PALETTE[(i - 1) % PALETTE.length],
                        ...(day === "all" ? { day: "all" } : { day }),
                        stopIds: [] as unknown as Prisma.InputJsonValue,
                    },
                });
                drivers.push({ id: created.id, name: created.name, color: created.color, day: created.day });
            }
        }

        // 3) Clear old assignments for this day
        await prisma.stop.updateMany({
            where: { ...(day === "all" ? {} : { day }) },
            data: { assignedDriverId: null, order: null },
        });

        await prisma.driver.updateMany({
            where: day === "all" ? {} : { day },
            data: { stopIds: [] as unknown as Prisma.InputJsonValue },
        });

        // 4) Assign stops for ALL planned routes (including Driver 0 now empty)
        for (let i = 0; i < plan.length; i++) {
            const driverName = `Driver ${i}`;
            const d = drivers.find((x) => x.name === driverName);
            if (!d) continue;

            const ids = (plan[i].stopIds ?? []).filter((v: any) => Number.isFinite(Number(v))).map((n: any) => Number(n));

            if (ids.length > 0) {
                await prisma.$transaction(
                    ids.map((stopId, idx) =>
                        prisma.stop.update({
                            where: { id: stopId },
                            data: { assignedDriverId: d.id, order: idx + 1 },
                        })
                    )
                );
            }

            await prisma.driver.update({
                where: { id: d.id },
                data: { stopIds: ids as unknown as Prisma.InputJsonValue },
            });
        }

        // 5) Remove any extra drivers beyond 0..k
        const keepNames = new Set<string>(Array.from({ length: k + 1 }, (_, i) => `Driver ${i}`));
        const present = await prisma.driver.findMany({ where: driverWhere, select: { id: true, name: true } });
        const keepIds = new Set<number>(present.filter((d) => keepNames.has(d.name)).map((d) => d.id));

        await prisma.driver.updateMany({
            where: { ...(day === "all" ? {} : { day }), id: { notIn: Array.from(keepIds) } },
            data: { stopIds: [] as unknown as Prisma.InputJsonValue },
        });
        await prisma.driver.deleteMany({
            where: { ...(day === "all" ? {} : { day }), id: { notIn: Array.from(keepIds) } },
        });

        // 6) Optional: rotate Driver 1..k so their first stop is nearest DF
        if (useDietFantasyStart) {
            for (let i = 1; i <= k; i++) {
                const driverName = `Driver ${i}`;
                const d = await prisma.driver.findFirst({
                    where: { name: driverName, ...(day === "all" ? {} : { day }) },
                    select: { id: true, stopIds: true },
                });
                if (!d) continue;

                const ids: number[] = Array.isArray(d.stopIds)
                    ? (d.stopIds as Array<number | string | null>)
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

                let bestIdx = 0;
                let bestDist = Number.POSITIVE_INFINITY;
                ordered.forEach((s, idx) => {
                    const lat = typeof s?.lat === "string" ? parseFloat(s.lat as any) : (s?.lat as number);
                    const lng = typeof s?.lng === "string" ? parseFloat(s.lng as any) : (s?.lng as number);
                    if (Number.isFinite(lat) && Number.isFinite(lng)) {
                        const dMi = haversineMiles(ORIGIN, { lat, lng });
                        if (dMi < bestDist) { bestDist = dMi; bestIdx = idx; }
                    }
                });

                const rotatedIds = rotateAtIndex(ids, bestIdx);

                await prisma.$transaction(
                    rotatedIds.map((sid, j) =>
                        prisma.stop.update({
                            where: { id: sid },
                            data: { order: j + 1 },
                        })
                    )
                );

                await prisma.driver.update({
                    where: { id: d.id },
                    data: { stopIds: rotatedIds as unknown as Prisma.InputJsonValue },
                });
            }
        }

        // 7) Respond (with a helpful count summary)
        const driversOut = await prisma.driver.findMany({
            where: driverWhere,
            orderBy: { id: "asc" }, // Driver 0 first
            select: { id: true, name: true, color: true, stopIds: true, day: true },
        });

        const geocodedCount = pts.length;
        const assignedCount = driversOut.reduce((sum, d) => sum + (Array.isArray(d.stopIds) ? d.stopIds.length : 0), 0);

        return NextResponse.json({
            ok: true,
            appliedStartRotation: useDietFantasyStart,
            origin: ORIGIN,
            routes: plan.map((r, i) => {
                const drv = driversOut.find((d) => d.name === `Driver ${i}`);
                return {
                    driverId: drv?.id ?? null,
                    driverName: drv?.name ?? `Driver ${i}`,
                    color: drv?.color ?? (i === 0 ? "#666666" : PALETTE[(i - 1) % PALETTE.length]),
                    count: Array.isArray(drv?.stopIds) ? (drv!.stopIds as any[]).length : 0,
                    center: r.center,
                    stopIds: drv?.stopIds ?? [],
                };
            }),
            message: `Geocoded: ${geocodedCount}. Assigned to active drivers: ${assignedCount} (Driver 0 absorbed).`,
        });
    } catch (e: any) {
        console.error("[/api/route/generate] Error:", e);
        return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
    }
}
