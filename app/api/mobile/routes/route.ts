// app/api/mobile/routes/route.ts
import { NextResponse } from "next/server";
// Use the same prisma instance style your map API uses:
import prisma from "../../../../lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Mobile routes derived from Driver + Stop (same source as the map):
 * - name: Driver.name
 * - color: Driver.color (as-is)
 * - stopIds: Driver.stopIds (filtered to existing stops)
 * - progress: ONLY manual (Stop.completed)
 */
export async function GET() {
    const t0 = Date.now();
    console.log("[mobile/routes] GET start");

    try {
        // 1) Load all drivers (no day filter for mobile; add if you need it)
        const drivers = await prisma.driver.findMany({
            orderBy: { id: "asc" },
            select: { id: true, name: true, color: true, stopIds: true },
        });
        console.log("[mobile/routes] drivers:", drivers.length);

        // 2) Collect all stopIds used by drivers
        const allStopIds = Array.from(
            new Set(
                drivers.flatMap((d) => (Array.isArray(d.stopIds) ? d.stopIds : []).map((n) => Number(n)).filter(Number.isFinite))
            )
        );
        console.log("[mobile/routes] unique stopIds:", allStopIds.length);

        // 3) Load those stops to compute progress (manual only)
        const stops = allStopIds.length
            ? await prisma.stop.findMany({
                where: { id: { in: allStopIds } },
                select: { id: true, completed: true },
            })
            : [];
        console.log("[mobile/routes] fetched stops:", stops.length);
        const stopById = new Map(stops.map((s) => [s.id, s]));

        // 4) Shape for mobile UI
        const shaped = drivers.map((d) => {
            const rawIds = Array.isArray(d.stopIds) ? d.stopIds : [];
            const filteredIds = rawIds
                .map((n) => Number(n))
                .filter((n) => Number.isFinite(n) && stopById.has(n));

            let completed = 0;
            for (const sid of filteredIds) {
                const st = stopById.get(sid)!;
                if (st.completed) completed++;
            }

            return {
                id: d.id,
                name: d.name,                       // Driver.name
                color: d.color ?? null,             // Driver.color (may be null)
                routeNumber: d.id,                  // keep label "Route {id}" in UI
                stopIds: filteredIds,               // ensure only existing stops
                totalStops: filteredIds.length,     // progress computed here
                completedStops: completed,
            };
        });

        console.log("[mobile/routes] shaped:", shaped.length, "in", Date.now() - t0, "ms");
        return NextResponse.json(shaped, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
        console.error("[mobile/routes] error:", e);
        return NextResponse.json([], { status: 200 });
    }
}