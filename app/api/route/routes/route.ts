// app/api/route/routes/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";

const sid = (v) => (v === null || v === undefined ? "" : String(v));

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const day = searchParams.get("day") || "all";

        const [drivers, allStops] = await Promise.all([
            prisma.driver.findMany({ where: { day }, orderBy: { id: "asc" } }),
            prisma.stop.findMany({ where: { day }, orderBy: { id: "asc" } }),
        ]);

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

        return NextResponse.json({ routes, unrouted }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
        console.error("routes GET error", e);
        return NextResponse.json({ routes: [], unrouted: [] }, { status: 200 });
    }
}