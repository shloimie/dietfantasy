export const runtime = "nodejs";       // send logs to server function logs
export const dynamic = "force-dynamic"; // belt & suspenders for App Router caching
// app/api/route/optimize/route.ts


import { NextRequest, NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";

// 🔁 ADJUST THIS IMPORT PATH to where you saved the planner file you pasted earlier.
import { planRoutesByAreaBalanced } from "../../../../utils/routing/areaBalance"; // <-- change if needed

const prisma = new PrismaClient();

// Diet Fantasy HQ (kept for single-driver local ordering helpers if needed)
const ORIGIN = { lat: 41.14602684379917, lng: -73.98927105396123 };

type Body = {
    day?: string;                  // "monday"..."sunday" or "all" (default "all")
    driverId?: number | string;    // optimize a single driver (local reorder only)
    useDietFantasyStart?: boolean; // if false, endpoint no-ops (back-compat)
};

function normalizeDay(raw?: string | null) {
    const s = String(raw ?? "all").toLowerCase().trim();
    const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday","all"];
    return days.includes(s) ? s : "all";
}

/** Safely coerce Prisma.JsonValue stopIds -> number[] */
function jsonToNumberArray(val: Prisma.JsonValue | null | undefined): number[] {
    if (!Array.isArray(val)) return [];
    return (val as Prisma.JsonArray)
        .map((v) => (v == null ? NaN : Number(v as any)))
        .filter((n) => Number.isFinite(n)) as number[];
}

/** ---------- Distance helpers (for single-driver fallback) ---------- */
type StopPt = { id: number; lat: number; lng: number };
function haversineMiles(a: {lat:number;lng:number}, b: {lat:number;lng:number}) {
    const R = 3958.7613;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function d(a: StopPt, b: StopPt) { return haversineMiles({lat:a.lat,lng:a.lng},{lat:b.lat,lng:b.lng}); }
function dOrigin(p: StopPt) { return haversineMiles(ORIGIN, {lat:p.lat, lng:p.lng}); }
function tourLength(points: StopPt[], tour: number[]): number {
    let sum = 0;
    for (let i = 0; i < tour.length - 1; i++) sum += d(points[tour[i]], points[tour[i+1]]);
    return sum;
}

/** Plain nearest-neighbor starting at the stop closest to ORIGIN (for single-driver path) */
function nearestNeighbor(points: StopPt[]): number[] {
    const n = points.length;
    if (n <= 1) return Array.from({ length: n }, (_, i) => i);
    let start = 0, bestO = Infinity;
    for (let i = 0; i < n; i++) {
        const o = dOrigin(points[i]);
        if (o < bestO) { bestO = o; start = i; }
    }
    const used = new Array(n).fill(false);
    const order: number[] = [];
    let current = start;
    order.push(current);
    used[current] = true;
    for (let k = 1; k < n; k++) {
        let bestJ = -1, bestD = Infinity;
        for (let j = 0; j < n; j++) {
            if (used[j]) continue;
            const dist = d(points[current], points[j]);
            if (dist < bestD) { bestD = dist; bestJ = j; }
        }
        current = bestJ;
        used[current] = true;
        order.push(current);
    }
    return order;
}

function twoOptImprove(points: StopPt[], order: number[], maxLoops = 60): number[] {
    const n = order.length;
    if (n < 4) return order.slice();
    const ord = order.slice();
    let improved = true, loops = 0;

    while (improved && loops < maxLoops) {
        improved = false; loops++;
        for (let i = 0; i < n - 3; i++) {
            for (let k = i + 2; k < n - 1; k++) {
                const a = ord[i], b = ord[i + 1], c = ord[k], e = ord[k + 1];
                const cur = d(points[a], points[b]) + d(points[c], points[e]);
                const swp = d(points[a], points[c]) + d(points[b], points[e]);
                if (swp + 1e-9 < cur) {
                    let lo = i + 1, hi = k;
                    while (lo < hi) { [ord[lo], ord[hi]] = [ord[hi], ord[lo]]; lo++; hi--; }
                    improved = true;
                }
            }
        }
    }
    return ord;
}

async function optimizeSingleDriver(driverId: number) {
    const driver = await prisma.driver.findUnique({
        where: { id: driverId },
        select: { id: true, stopIds: true },
    });
    if (!driver) return { driverId, changed: false, reason: "driver not found" };

    const ids: number[] = jsonToNumberArray(driver.stopIds);
    if (!ids.length) return { driverId, changed: false, reason: "no stops" };

    const stops = await prisma.stop.findMany({
        where: { id: { in: ids }, /* optional: completed: false */ },
        select: { id: true, lat: true, lng: true },
    });
    const byId = new Map(stops.map((s) => [s.id, s]));

    const geo: StopPt[] = [];
    const ungeoIds: number[] = [];
    for (const sid of ids) {
        const s = byId.get(sid);
        if (s && typeof s.lat === "number" && typeof s.lng === "number") geo.push({ id: s.id, lat: s.lat, lng: s.lng });
        else ungeoIds.push(sid);
    }

    let optimizedIds: number[];
    if (geo.length <= 1) {
        optimizedIds = [...ids];
    } else {
        let ord = nearestNeighbor(geo);
        ord = twoOptImprove(geo, ord, 60);
        const geoOrderedIds = ord.map((i) => geo[i].id);
        optimizedIds = [...geoOrderedIds, ...ungeoIds];
        const seen = new Set(optimizedIds);
        for (const sid of ids) if (!seen.has(sid)) optimizedIds.push(sid);
    }

    await prisma.$transaction([
        // update Stop.order + assigned mirror
        ...optimizedIds.map((sid, i) =>
            prisma.stop.update({ where: { id: sid }, data: { order: i + 1, assignedDriverId: driverId } })
        ),
        // update Driver.stopIds
        prisma.driver.update({
            where: { id: driver.id },
            data: { stopIds: optimizedIds as unknown as Prisma.InputJsonValue },
        }),
    ]);

    return {
        driverId,
        changed: true,
        optimizedCount: optimizedIds.length,
        approxMiles: geo.length ? tourLength(geo, nearestNeighbor(geo)) : null,
    };
}

/** ---------- Area-balanced replan for a whole day ---------- */
export async function POST(req: NextRequest) {
    try {
        const body = (await req.json()) as Body;
        const day = normalizeDay(body.day);
        const useDietFantasyStart = !!body.useDietFantasyStart;
        const oneDriverId = body.driverId != null ? Number(body.driverId) : null;

        if (!useDietFantasyStart) {
            return NextResponse.json({ ok: true, appliedOptimization: false, summary: [] });
        }

        // Single-driver local reorder (does NOT reassign across drivers)
        if (oneDriverId !== null && Number.isFinite(oneDriverId)) {
            const result = await optimizeSingleDriver(oneDriverId);
            return NextResponse.json({ ok: true, appliedOptimization: true, version: "v3-area-balanced", summary: [result] });
        }

        // 1) Load drivers for the day
        const drivers = await prisma.driver.findMany({
            where: day === "all" ? {} : { day },
            select: { id: true, name: true, color: true },
            orderBy: { id: "asc" },
        });
        const driverCount = drivers.length;
        if (driverCount === 0) {
            return NextResponse.json({ ok: true, appliedOptimization: false, summary: [], note: "No drivers for selected day." });
        }

        // 2) Take all NOT-completed stops for that day (we won't shuffle completed ones)
        const stops = await prisma.stop.findMany({
            where: {
                ...(day === "all" ? {} : { day }),
                completed: false,
            },
            select: { id: true, lat: true, lng: true },
            orderBy: { id: "asc" },
        });

        // Build points for planner (geocoded only)
        const points = stops
            .filter(s => typeof s.lat === "number" && typeof s.lng === "number")
            .map(s => ({ id: s.id, lat: s.lat as number, lng: s.lng as number }));

        // 3) Call the SAME logic (strict outliers -> driver 0)
        const planned = planRoutesByAreaBalanced(points, driverCount);
        // planned[0] is transfer bucket (driverIndex 0)
        const transfer = planned.find(p => p.driverIndex === 0) || { stopIds: [] as number[] };
        const buckets = planned.filter(p => p.driverIndex > 0);

        // Guard: buckets count can be <= driverCount if points are scarce
        const k = Math.min(buckets.length, driverCount);

        // 4) Persist: for each driver i (sorted by id), set their stopIds/order/assignedDriverId
        const tx: Prisma.PrismaPromise<any>[] = [];

        // a) Clear existing orders for all not-completed stops in scope (avoid stale orders)
        tx.push(
            prisma.stop.updateMany({
                where: { ...(day === "all" ? {} : { day }), completed: false },
                data: { order: null, assignedDriverId: null },
            })
        );

        // b) Assign outliers to Driver 0 mirror
        if (transfer.stopIds.length) {
            tx.push(
                prisma.stop.updateMany({
                    where: { id: { in: transfer.stopIds } },
                    data: { assignedDriverId: 0, order: null },
                })
            );
        }

        // c) For each real driver slot, assign the corresponding bucket by index order
        for (let i = 0; i < k; i++) {
            const driver = drivers[i];
            const bucket = buckets[i];
            const ids = bucket.stopIds;

            // update stops: set order and assignedDriverId
            ids.forEach((sid, idx) => {
                tx.push(
                    prisma.stop.update({
                        where: { id: sid },
                        data: { order: idx + 1, assignedDriverId: driver.id },
                    })
                );
            });

            // update driver.stopIds
            tx.push(
                prisma.driver.update({
                    where: { id: driver.id },
                    data: { stopIds: ids as unknown as Prisma.InputJsonValue },
                })
            );
        }

        // d) For any remaining drivers with no bucket (k < driverCount), set empty stopIds
        for (let i = k; i < driverCount; i++) {
            const driver = drivers[i];
            tx.push(
                prisma.driver.update({
                    where: { id: driver.id },
                    data: { stopIds: [] as unknown as Prisma.InputJsonValue },
                })
            );
        }

        await prisma.$transaction(tx);

        // Build summary
        const summary = drivers.slice(0, k).map((d, i) => ({
            driverId: d.id,
            assignedCount: buckets[i]?.count ?? 0,
        }));

        return NextResponse.json({
            ok: true,
            version: "v3-area-balanced",
            appliedOptimization: true,
            transferCount: transfer.stopIds.length,
            summary,
        });
    } catch (e: any) {
        console.error("[/api/route/optimize] error", e);
        return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
    }
}