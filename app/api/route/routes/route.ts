// app/api/route/routes/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";

const sid = (v) => (v === null || v === undefined ? "" : String(v));

/** Extracts the numeric suffix from "Driver X" safely; unknowns go to the end */
function driverRankByName(name) {
    const m = /driver\s+(\d+)/i.exec(String(name || ""));
    return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const day = searchParams.get("day") || "all";

        // Pull everything (don’t rely on DB id for order)
        const [driversRaw, allStops] = await Promise.all([
            prisma.driver.findMany({ where: { day } }),
            prisma.stop.findMany({ where: { day }, orderBy: { id: "asc" } }),
        ]);

        // Sort drivers by numeric suffix so Driver 0 is always first, then 1, 2, …
        const drivers = [...driversRaw].sort(
            (a, b) => driverRankByName(a.name) - driverRankByName(b.name)
        );

        const stopById = new Map(allStops.map((s) => [sid(s.id), s]));

        // Expand drivers with only existing stops (filters stale ids)
        const routes = drivers.map((d) => {
            const ids = Array.isArray(d.stopIds) ? d.stopIds : [];
            const stops = [];
            for (const raw of ids) {
                const s = stopById.get(sid(raw));
                if (s) stops.push(s);
            }
            return {
                driverId: d.id,
                driverName: d.name,
                color: d.color,
                stops,
            };
        });

        // Unrouted = all stops not included in any driver's current list
        const claimed = new Set(routes.flatMap((r) => r.stops.map((s) => sid(s.id))));
        const unrouted = allStops.filter((s) => !claimed.has(sid(s.id)));

        return NextResponse.json(
            { routes, unrouted },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (e) {
        console.error("routes GET error", e);
        return NextResponse.json({ routes: [], unrouted: [] }, { status: 200 });
    }
}