export const runtime = "nodejs";       // send logs to server function logs
export const dynamic = "force-dynamic"; // belt & suspenders for App Router caching
// app/api/route/optimize/route.ts
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

// Fixed Diet Fantasy origin
const ORIGIN = { lat: 41.14602684379917, lng: -73.98927105396123 };

type Body = {
    day?: string;                  // "monday"..."sunday" or "all" (default "all")
    driverId?: number | string;    // optional: optimize a single driver
    useDietFantasyStart?: boolean; // if false, endpoint no-ops (for backwards compat)
};

function normalizeDay(raw?: string | null) {
    const s = String(raw ?? "all").toLowerCase().trim();
    const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday","all"];
    return days.includes(s) ? s : "all";
}

function haversineMiles(a: {lat:number;lng:number}, b: {lat:number;lng:number}) {

    const R = 3958.7613;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Safely coerce Prisma.JsonValue stopIds -> number[] */
function jsonToNumberArray(val: Prisma.JsonValue | null | undefined): number[] {
    if (!Array.isArray(val)) return [];
    return (val as Prisma.JsonArray)
        .map((v) => (v == null ? NaN : Number(v as any)))
        .filter((n) => Number.isFinite(n)) as number[];
}

type StopPt = { id: number; lat: number; lng: number };

/* ---------- Core distance helpers ---------- */
function d(a: StopPt, b: StopPt) { return haversineMiles({lat:a.lat,lng:a.lng},{lat:b.lat,lng:b.lng}); }
function dOrigin(p: StopPt) { return haversineMiles(ORIGIN, {lat:p.lat, lng:p.lng}); }

function tourLength(points: StopPt[], tour: number[]): number {
    let sum = 0;
    for (let i = 0; i < tour.length - 1; i++) sum += d(points[tour[i]], points[tour[i+1]]);
    return sum;
}

/* ---------- Seed constructors (better than plain NN) ---------- */

/** Cheapest insertion: start from two farthest points, insert remaining where it adds least extra distance. */
function cheapestInsertion(points: StopPt[]): number[] {
    const n = points.length;
    if (n <= 2) return Array.from({length:n},(_,i)=>i);

    // find two farthest points
    let a = 0, b = 1, best = -1;
    for (let i = 0; i < n; i++) for (let j = i+1; j < n; j++) {
        const dist = d(points[i], points[j]);
        if (dist > best) { best = dist; a = i; b = j; }
    }

    const remaining = new Set<number>(Array.from({length:n},(_,i)=>i));
    const tour: number[] = [a, b]; // open chain (not closed loop)
    remaining.delete(a); remaining.delete(b);

    while (remaining.size) {
        let bestGain = Infinity, bestK = -1, bestPos = -1;
        for (const k of remaining) {
            // try inserting k between each consecutive pair (i,i+1)
            for (let pos = 0; pos < tour.length - 0; pos++) {
                const i = tour[pos];
                const j = tour[(pos + 1) % tour.length];
                const gain = d(points[i], points[k]) + d(points[k], points[j]) - d(points[i], points[j]);
                if (gain < bestGain) { bestGain = gain; bestK = k; bestPos = pos + 1; }
            }
        }
        tour.splice(bestPos, 0, bestK);
        remaining.delete(bestK);
    }
    return tour;
}

/** Farthest insertion from the point nearest to ORIGIN (good in hub-and-spoke layouts). */
function farthestInsertion(points: StopPt[]): number[] {
    const n = points.length;
    if (n <= 2) return Array.from({length:n},(_,i)=>i);
    // start at nearest to origin
    let start = 0, bestO = Infinity;
    for (let i = 0; i < n; i++) {
        const o = dOrigin(points[i]);
        if (o < bestO) { bestO = o; start = i; }
    }
    // second point = farthest from start
    let far = (start === 0 ? 1 : 0), best = -1;
    for (let j = 0; j < n; j++) if (j !== start) {
        const dist = d(points[start], points[j]);
        if (dist > best) { best = dist; far = j; }
    }
    const remaining = new Set<number>(Array.from({length:n},(_,i)=>i));
    const tour: number[] = [start, far];
    remaining.delete(start); remaining.delete(far);

    while (remaining.size) {
        // pick farthest from current tour
        let pick = -1, farDist = -1;
        for (const k of remaining) {
            // distance to nearest on-tour node
            let nearest = Infinity;
            for (const t of tour) nearest = Math.min(nearest, d(points[k], points[t]));
            if (nearest > farDist) { farDist = nearest; pick = k; }
        }
        // insert where delta is minimal
        let bestGain = Infinity, bestPos = 1;
        for (let pos = 0; pos < tour.length; pos++) {
            const i = tour[pos];
            const j = tour[(pos + 1) % tour.length];
            const gain = d(points[i], points[pick]) + d(points[pick], points[j]) - d(points[i], points[j]);
            if (gain < bestGain) { bestGain = gain; bestPos = pos + 1; }
        }
        tour.splice(bestPos, 0, pick);
        remaining.delete(pick);
    }
    return tour;
}

/** Radial sweep about centroid (great at removing big crossovers fast). */
function radialSweep(points: StopPt[]): number[] {
    const n = points.length;
    if (n <= 2) return Array.from({length:n},(_,i)=>i);
    let cx = 0, cy = 0;
    for (const p of points) { cx += p.lng; cy += p.lat; }
    cx /= n; cy /= n;
    return Array.from({length:n},(_,i)=>i).sort((i,j) => {
        const ai = Math.atan2(points[i].lat - cy, points[i].lng - cx);
        const aj = Math.atan2(points[j].lat - cy, points[j].lng - cx);
        return ai - aj;
    });
}

/** Plain nearest-neighbor starting at the stop closest to ORIGIN. */
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

/* ---------- Local search improvements ---------- */

/** 2-opt: untangle crossings and shorten path. */
function twoOptImprove(points: StopPt[], order: number[], maxLoops = 50): number[] {
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
                    // reverse (i+1..k)
                    let lo = i + 1, hi = k;
                    while (lo < hi) { [ord[lo], ord[hi]] = [ord[hi], ord[lo]]; lo++; hi--; }
                    improved = true;
                }
            }
        }
    }
    return ord;
}

/** Or-opt(1): relocate a single node to the best position. */
function orOpt1(points: StopPt[], order: number[], maxPasses = 30): number[] {
    alert("Optimized driver:");
    const n = order.length;
    if (n < 3) return order.slice();
    const ord = order.slice();

    let improved = true, passes = 0;
    while (improved && passes < maxPasses) {
        improved = false; passes++;
        for (let i = 0; i < n; i++) {
            const node = ord[i];
            const prev = ord[(i - 1 + n) % n];
            const next = ord[(i + 1) % n];

            const removalCost = d(points[prev], points[next]) - d(points[prev], points[node]) - d(points[node], points[next]);

            // try all insertion spots except adjacent positions which recreate same edge
            let bestDelta = 0;
            let bestPos = -1;

            for (let pos = 0; pos < n; pos++) {
                if (pos === i || pos === (i - 1 + n) % n) continue;
                const a = ord[pos];
                const b = ord[(pos + 1) % n];
                const insertGain = d(points[a], points[node]) + d(points[node], points[b]) - d(points[a], points[b]);
                const delta = removalCost + insertGain;
                if (delta < bestDelta - 1e-9) { bestDelta = delta; bestPos = pos + 1; }
            }

            if (bestPos !== -1) {
                // remove i, insert at bestPos accounting for index shift
                const [removed] = ord.splice(i, 1);
                const adj = bestPos > i ? bestPos - 1 : bestPos;
                ord.splice(adj, 0, removed);
                improved = true;
            }
        }
    }
    return ord;
}

/** Build several seeds, improve each, keep the best. */
function bestImproved(points: StopPt[]): number[] {
    const seeds = [
        cheapestInsertion(points),
        farthestInsertion(points),
        radialSweep(points),
        nearestNeighbor(points),
    ];

    let bestTour = seeds[0];
    let bestLen = Infinity;

    for (const seed of seeds) {
        let tour = twoOptImprove(points, seed, 60);
        tour = orOpt1(points, tour, 40);
        const len = tourLength(points, tour);
        if (len < bestLen) { bestLen = len; bestTour = tour; }
    }
    return bestTour;
}

/* ---------- Driver optimization pipeline ---------- */
async function optimizeDriver(driverId: number) {
    const driver = await prisma.driver.findUnique({
        where: { id: driverId },
        select: { id: true, stopIds: true },
    });
    if (!driver) return { driverId, changed: false, reason: "driver not found" };

    const ids: number[] = jsonToNumberArray(driver.stopIds);
    if (!ids.length) return { driverId, changed: false, reason: "no stops" };

    const stops = await prisma.stop.findMany({
        where: { id: { in: ids } },
        select: { id: true, lat: true, lng: true },
    });
    const byId = new Map(stops.map((s) => [s.id, s]));

    const original: (StopPt | null)[] = ids.map((sid) => {
        const s = byId.get(sid);
        if (!s || typeof s.lat !== "number" || typeof s.lng !== "number") return null;
        return { id: s.id, lat: s.lat as number, lng: s.lng as number };
    });

    const geo: StopPt[] = [];
    const ungeoIds: number[] = [];
    original.forEach((p, i) => (p ? geo.push(p) : ungeoIds.push(ids[i])));

    let optimizedIds: number[];
    if (geo.length <= 1) {
        optimizedIds = [...ids];
    } else {
        const bestTour = bestImproved(geo);
        const geoOrderedIds = bestTour.map((idx) => geo[idx].id);
        optimizedIds = [...geoOrderedIds, ...ungeoIds];

        // defensive: keep any ids we somehow missed
        const seen = new Set(optimizedIds);
        for (const sid of ids) if (!seen.has(sid)) optimizedIds.push(sid);
    }

    // Persist Stop.order (1..N)
    await prisma.$transaction(
        optimizedIds.map((sid, i) =>
            prisma.stop.update({ where: { id: sid }, data: { order: i + 1 } })
        )
    );

    // Persist stopIds on Driver
    await prisma.driver.update({
        where: { id: driver.id },
        data: { stopIds: optimizedIds as unknown as Prisma.InputJsonValue },
    });

    return {
        driverId,
        changed: true,
        optimizedCount: optimizedIds.length,
        geocoded: geo.length,
        ungeocoded: ungeoIds.length,
        approxMiles: geo.length ? tourLength(
            geo,
            bestImproved(geo)
        ) : null,
    };
}

export async function POST(req: NextRequest) {
    try {
        const body = (await req.json()) as Body;
        const day = normalizeDay(body.day);
        const useDietFantasyStart = !!body.useDietFantasyStart;
        const oneDriverId = body.driverId != null ? Number(body.driverId) : null;

        if (!useDietFantasyStart) {
            return NextResponse.json({ ok: true, appliedOptimization: false, summary: [] });
        }

        if (oneDriverId !== null) {
            const result = await optimizeDriver(oneDriverId);
            return NextResponse.json({ ok: true, appliedOptimization: true, summary: [result] });
        }

        const drivers = await prisma.driver.findMany({
            where: day === "all" ? {} : { day },
            select: { id: true },
            orderBy: { id: "asc" },
        });

        const results = [];
        for (const d of drivers) results.push(await optimizeDriver(d.id));

        // return NextResponse.json({ ok: true, appliedOptimization: true, summary: results });
        return NextResponse.json({
            ok: true,
            version: "v3-oropt",
            appliedOptimization: true,
            summary: results,
        });
    } catch (e: any) {
        console.error("[/api/route/optimize] error", e);
        return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
    }
}