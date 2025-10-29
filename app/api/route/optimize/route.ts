export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// app/api/route/optimize/route.ts

import { NextRequest, NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";

import { planRoutesByAreaBalanced } from "../../../../utils/routing/areaBalance";

const prisma = new PrismaClient();

const ORIGIN = { lat: 41.14602684379917, lng: -73.98927105396123 };

type Body = {
    day?: string;
    driverId?: number | string;
    useDietFantasyStart?: boolean;
    consolidateDuplicates?: boolean; // NEW: run duplicate-address consolidation across drivers
};

function normalizeDay(raw?: string | null) {
    const s = String(raw ?? "all").toLowerCase().trim();
    const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday","all"];
    return days.includes(s) ? s : "all";
}

function jsonToNumberArray(val: Prisma.JsonValue | null | undefined): number[] {
    if (!Array.isArray(val)) return [];
    return (val as Prisma.JsonArray)
        .map((v) => (v == null ? NaN : Number(v as any)))
        .filter((n) => Number.isFinite(n)) as number[];
}

/* ----------------- distance + TSP helpers (unchanged) ----------------- */
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

/* ----------------- NEW: duplicate-address consolidation ----------------- */
// We’ll consolidate using a normalized address key. If your Stop fields differ,
// tweak `addrKeyOf`.
function norm(s: unknown) {
    return String(s ?? "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[^\p{L}\p{N}\s]/gu, "")
        .trim();
}
function addrKeyOf(s: {
    address?: string | null;
    apt?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
}) {
    return norm([s.address, s.apt, s.city, s.state, s.zip].filter(Boolean).join(","));
}

/**
 * Move stops that share the *same normalized address* onto the same driver:
 * pick the driver who already has the plurality for that address.
 * Only affects not-completed stops for the selected day.
 */
async function consolidateDuplicateAddresses(day: string) {
    // Load not-completed stops with address + driver
    const stops = await prisma.stop.findMany({
        where: { ...(day === "all" ? {} : { day }), completed: false },
        select: { id: true, address: true, apt: true, city: true, state: true, zip: true, assignedDriverId: true },
    });

    type G = { key: string; ids: number[]; byDriver: Map<number, number> };
    const groups = new Map<string, G>();

    for (const s of stops) {
        const key = addrKeyOf(s);
        if (!key) continue;
        let g = groups.get(key);
        if (!g) { g = { key, ids: [], byDriver: new Map() }; groups.set(key, g); }
        g.ids.push(s.id);
        const d = Number(s.assignedDriverId ?? NaN);
        if (Number.isFinite(d)) g.byDriver.set(d, (g.byDriver.get(d) || 0) + 1);
    }

    const tx: Prisma.PrismaPromise<any>[] = [];
    const affectedDrivers = new Set<number>();

    for (const g of groups.values()) {
        if (g.ids.length < 2) continue; // only care about duplicates

        // choose the driver with the max count for this address (plurality)
        let winner: number | null = null, best = -1;
        for (const [driverId, cnt] of g.byDriver.entries()) {
            if (cnt > best) { best = cnt; winner = driverId; }
        }
        if (winner == null || !Number.isFinite(winner)) continue;

        // fetch current assignment for these ids
        const cur = await prisma.stop.findMany({
            where: { id: { in: g.ids } },
            select: { id: true, assignedDriverId: true },
        });

        const needsMove = cur.filter(s => s.assignedDriverId !== winner).map(s => s.id);
        if (!needsMove.length) continue;

        // move all duplicates to the winner (keep order untouched here; per-driver reorder handles it later)
        tx.push(
            prisma.stop.updateMany({
                where: { id: { in: needsMove } },
                data: { assignedDriverId: winner },
            })
        );

        // track drivers to rebuild their stopIds mirrors
        for (const s of cur) {
            if (s.assignedDriverId != null) affectedDrivers.add(Number(s.assignedDriverId));
        }
        affectedDrivers.add(Number(winner));
    }

    if (tx.length) {
        await prisma.$transaction(tx);

        // rebuild stopIds for affected drivers (mirror field)
        const byDriver = await prisma.stop.groupBy({
            by: ["assignedDriverId"],
            where: { ...(day === "all" ? {} : { day }), completed: false, assignedDriverId: { not: null } },
            _count: { _all: true },
        });

        const existingDrivers = new Set<number>(byDriver.map(x => Number(x.assignedDriverId)));
        for (const driverId of [...affectedDrivers]) {
            if (!Number.isFinite(driverId)) continue;
            // Fetch all current stops for this driver and write back the list (order preserved if present)
            const ids = (await prisma.stop.findMany({
                where: { assignedDriverId: driverId, ...(day === "all" ? {} : { day }), completed: false },
                select: { id: true, order: true },
                orderBy: [{ order: "asc" }, { id: "asc" }],
            })).map(s => s.id);

            await prisma.driver.update({
                where: { id: driverId },
                data: { stopIds: ids as unknown as Prisma.InputJsonValue },
            }).catch(() => void 0);
        }

        return { changed: true, affectedDrivers: [...affectedDrivers].filter(Number.isFinite) as number[] };
    }
    return { changed: false, affectedDrivers: [] as number[] };
}

/* ----------------- single-driver local reorder ----------------- */
async function optimizeSingleDriver(driverId: number) {
    const driver = await prisma.driver.findUnique({
        where: { id: driverId },
        select: { id: true, stopIds: true },
    });
    if (!driver) return { driverId, changed: false, reason: "driver not found" };

    const ids: number[] = jsonToNumberArray(driver.stopIds);
    if (!ids.length) return { driverId, changed: false, reason: "no stops" };

    const stops = await prisma.stop.findMany({
        where: { id: { in: ids }, /* completed: false */ },
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
        ...optimizedIds.map((sid, i) =>
            prisma.stop.update({ where: { id: sid }, data: { order: i + 1, assignedDriverId: driverId } })
        ),
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

/* ----------------- POST handler ----------------- */
export async function POST(req: NextRequest) {
    try {
        const body = (await req.json()) as Body;
        const day = normalizeDay(body.day);
        const useDietFantasyStart = !!body.useDietFantasyStart;
        const oneDriverId = body.driverId != null ? Number(body.driverId) : null;
        const consolidateDuplicates = !!body.consolidateDuplicates; // NEW

        if (!useDietFantasyStart) {
            return NextResponse.json({ ok: true, appliedOptimization: false, summary: [] });
        }

        // NEW: optional pre-pass to consolidate duplicate addresses across drivers
        if (consolidateDuplicates) {
            const res = await consolidateDuplicateAddresses(day);
            // return a small ack (client will follow with per-driver optimization)
            return NextResponse.json({
                ok: true,
                appliedOptimization: true,
                phase: "consolidate-duplicates",
                changed: res.changed,
                affectedDrivers: res.affectedDrivers,
            });
        }

        // Single-driver local reorder only
        if (oneDriverId !== null && Number.isFinite(oneDriverId)) {
            const result = await optimizeSingleDriver(oneDriverId);
            return NextResponse.json({ ok: true, appliedOptimization: true, version: "v3-local", summary: [result] });
        }

        // NOTE: we intentionally do NOT call area-balance here for "optimize" in your requested behavior.
        // If you ever want global re-balance, call this endpoint WITHOUT driverId AND WITHOUT consolidateDuplicates,
        // and switch to the logic below. For now, keep disabled to avoid cross-driver moves.
        //
        // --- disabled global replan path ---
        // const drivers = await prisma.driver.findMany({ ... });
        // const stops = await prisma.stop.findMany({ ... });
        // const planned = planRoutesByAreaBalanced(...);
        // ... persist plan ...
        // return NextResponse.json({ ok: true, appliedOptimization: true, version: "v3-area-balanced", ... });

        return NextResponse.json({
            ok: true,
            appliedOptimization: false,
            note: "No action taken. Provide driverId for local reorder, or set consolidateDuplicates=true for the pre-pass.",
        });
    } catch (e: any) {
        console.error("[/api/route/optimize] error", e);
        return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
    }
}