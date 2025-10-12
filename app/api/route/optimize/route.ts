import { NextRequest, NextResponse } from "next/server";
import { PrismaClient, Stop } from "@prisma/client";

const prisma = new PrismaClient();

type Pt = { id: number; lat: number; lng: number };

function distance(a: Pt, b: Pt) {
    const dLat = a.lat - b.lat;
    const dLng = a.lng - b.lng;
    // Euclidean in degrees is fine for short distances; if you prefer Haversine, plug it in.
    return Math.sqrt(dLat * dLat + dLng * dLng);
}

/**
 * Basic nearest-neighbor tour:
 * - Start at the stop with the smallest current "order" if present,
 *   otherwise the westernmost (min lng).
 */
function nearestNeighborOrder(points: Pt[], existing: Stop[]) {
    if (points.length <= 1) return points.map(p => p.id);

    // Prefer existing smallest order as a starting anchor to avoid total churn
    const withOrder = existing
        .filter(s => typeof s.order === "number" && points.some(p => p.id === s.id))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    let startId: number;
    if (withOrder.length > 0) {
        startId = withOrder[0].id;
    } else {
        // fallback: westernmost
        startId = points.reduce((minId, p) => {
            const minP = points.find(pp => pp.id === minId)!;
            return p.lng < minP.lng ? p.id : minId;
        }, points[0].id);
    }

    const remaining = new Map(points.map(p => [p.id, p]));
    const path: number[] = [];

    let current = remaining.get(startId)!;
    remaining.delete(startId);
    path.push(current.id);

    while (remaining.size) {
        let best: Pt | null = null;
        let bestD = Infinity;
        for (const p of remaining.values()) {
            const d = distance(current, p);
            if (d < bestD) {
                bestD = d;
                best = p;
            }
        }
        current = best!;
        path.push(current.id);
        remaining.delete(current.id);
    }
    return path;
}

/**
 * POST /api/route/optimize
 * body: { driverId: number, day?: string }
 * If day is omitted, optimizes across all days for that driver (usually you’ll pass the active day).
 */
export async function POST(req: NextRequest) {
    try {
        const { driverId, day } = await req.json();

        if (!driverId || typeof driverId !== "number") {
            return NextResponse.json({ error: "driverId (number) required" }, { status: 400 });
        }

        const where: any = { assignedDriverId: driverId };
        if (day && typeof day === "string") where.day = day;

        const stops = await prisma.stop.findMany({
            where,
            orderBy: [{ order: "asc" }, { id: "asc" }],
        });

        const geocoded = stops.filter(s => typeof s.lat === "number" && typeof s.lng === "number");
        const missingGeo = stops.length - geocoded.length;

        if (geocoded.length < 2) {
            // Nothing to optimize
            return NextResponse.json({
                ok: true,
                optimized: 0,
                note: geocoded.length === 0 ? "No geocoded stops" : "Only one geocoded stop",
                missingGeo,
            });
        }

        const pts: Pt[] = geocoded.map(s => ({ id: s.id, lat: s.lat!, lng: s.lng! }));
        const orderIds = nearestNeighborOrder(pts, stops);

        // Persist new order (1-based index so it reads nicely in UIs)
        // NOTE: we only reorder the geocoded subset; un-geocoded stops get appended after.
        const updates: { id: number; order: number }[] = [];
        orderIds.forEach((id, idx) => updates.push({ id, order: idx + 1 }));

        // Append non-geocoded stops after the optimized list, preserving their previous relative order
        let next = updates.length + 1;
        stops
            .filter(s => !geocoded.some(g => g.id === s.id))
            .forEach(s => updates.push({ id: s.id, order: next++ }));

        // Batched updates
        await prisma.$transaction(
            updates.map(u =>
                prisma.stop.update({
                    where: { id: u.id },
                    data: { order: u.order },
                })
            )
        );

        return NextResponse.json({
            ok: true,
            optimized: orderIds.length,
            appendedWithoutGeo: updates.length - orderIds.length,
            missingGeo,
        });
    } catch (err: any) {
        console.error("[/api/route/optimize] Error:", err);
        return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
}