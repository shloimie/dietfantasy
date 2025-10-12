// app/api/route/optimize/route.ts
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

// Fixed Diet Fantasy origin
const ORIGIN = { lat: 41.14602684379917, lng: -73.98927105396123 };

type Body = {
    day?: string;                  // "monday"..."sunday" or "all" (default "all")
    driverId?: number | string;    // optional: rotate a single driver
    useDietFantasyStart?: boolean; // if false, we simply return ok without changes
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

function rotateAtIndex<T>(arr: T[], idx: number) {
    if (!arr.length || idx <= 0) return arr.slice();
    return [...arr.slice(idx), ...arr.slice(0, idx)];
}

/** Safely coerce Prisma.JsonValue stopIds -> number[] */
function jsonToNumberArray(val: Prisma.JsonValue | null | undefined): number[] {
    if (!Array.isArray(val)) return [];
    // val is now JsonArray; coerce each entry to number if possible
    return (val as Prisma.JsonArray)
        .map((v) => (v == null ? NaN : Number(v as any)))
        .filter((n) => Number.isFinite(n)) as number[];
}

/**
 * Rotate one driver so their first stop is the one nearest to ORIGIN.
 * Persists Stop.order (1..N) and Driver.stopIds.
 */
async function rotateDriverToDietFantasyStart(driverId: number) {
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
    const ordered = ids.map((sid) => byId.get(sid)!).filter(Boolean);

    // pick nearest index that has coords
    let bestIdx = 0, bestDist = Number.POSITIVE_INFINITY;
    ordered.forEach((s, i) => {
        if (typeof s?.lat === "number" && typeof s?.lng === "number") {
            const dMi = haversineMiles(ORIGIN, { lat: s.lat!, lng: s.lng! });
            if (dMi < bestDist) { bestDist = dMi; bestIdx = i; }
        }
    });

    const rotatedIds = rotateAtIndex(ids, bestIdx);

    // Persist orders 1..N (array overload, no timeout/options)
    await prisma.$transaction(
        rotatedIds.map((sid, i) =>
            prisma.stop.update({
                where: { id: sid },
                data: { order: i + 1 },
            })
        )
    );

    // Persist stopIds on Driver
    await prisma.driver.update({
        where: { id: driver.id },
        data: { stopIds: rotatedIds as unknown as Prisma.InputJsonValue },
    });

    return { driverId, changed: true, bestIdx };
}

export async function POST(req: NextRequest) {
    try {
        const body = (await req.json()) as Body;
        const day = normalizeDay(body.day);
        const useDietFantasyStart = !!body.useDietFantasyStart;
        const oneDriverId = body.driverId != null ? Number(body.driverId) : null;

        if (!useDietFantasyStart) {
            // no-op, but keep endpoint forgiving
            return NextResponse.json({ ok: true, appliedStartRotation: false, summary: [] });
        }

        // IMPORTANT: check !== null (0 is a valid number but falsy)
        if (oneDriverId !== null) {
            const result = await rotateDriverToDietFantasyStart(oneDriverId);
            return NextResponse.json({
                ok: true,
                appliedStartRotation: true,
                summary: [result],
            });
        }

        // Otherwise rotate all drivers for the given day
        const drivers = await prisma.driver.findMany({
            where: day === "all" ? {} : { day },
            select: { id: true },
            orderBy: { id: "asc" },
        });

        const results = [];
        for (const d of drivers) {
            const r = await rotateDriverToDietFantasyStart(d.id);
            results.push(r);
        }

        return NextResponse.json({
            ok: true,
            appliedStartRotation: true,
            summary: results,
        });
    } catch (e: any) {
        console.error("[/api/route/optimize] error", e);
        return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
    }
}