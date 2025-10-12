// app/api/mobile/routes/route.ts
import { NextResponse } from "next/server";
import { Stop } from "@prisma/client";
import prisma from "../../../../lib/prisma";

export const dynamic = "force-dynamic";

// Narrow type used for the Map so TS knows `.completed` exists
type StopLite = Pick<Stop, "id" | "completed">;

/**
 * Returns lightweight route summaries for mobile:
 * - id, name, color
 * - stopIds (existing only)
 * - totalStops, completedStops
 */
export async function GET() {
    const t0 = Date.now();
    console.log("[mobile/routes] GET start");

    try {
        // 1) All drivers (add day filter here if you later need it)
        const drivers = await prisma.driver.findMany({
            orderBy: { id: "asc" },
            select: { id: true, name: true, color: true, stopIds: true },
        });
        console.log("[mobile/routes] drivers:", drivers.length);

        // 2) Collect unique stopIds
        const allStopIds = Array.from(
            new Set(
                drivers.flatMap((d) =>
                    Array.isArray(d.stopIds)
                        ? d.stopIds.map((n) => Number(n)).filter(Number.isFinite)
                        : []
                )
            )
        );
        console.log("[mobile/routes] unique stopIds:", allStopIds.length);

        // 3) Load minimal stop info to compute progress
        const stops = allStopIds.length
            ? await prisma.stop.findMany({
                where: { id: { in: allStopIds } },
                select: { id: true, completed: true },
            })
            : [];

        // Typed map so `get()` returns StopLite | undefined (not unknown)
        const stopById = new Map<number, StopLite>();
        for (const s of stops as StopLite[]) stopById.set(s.id, s);

        // 4) Shape per driver
        const shaped = drivers.map((d) => {
            const rawIds = Array.isArray(d.stopIds) ? d.stopIds : [];
            const filteredIds = rawIds
                .map((n) => Number(n))
                .filter((n) => Number.isFinite(n) && stopById.has(n));

            let completed = 0;
            for (const sid of filteredIds) {
                const st = stopById.get(sid);
                if (st && st.completed) completed++;
            }

            return {
                id: d.id,
                name: d.name,
                color: d.color ?? null,
                routeNumber: d.id, // keeps "Route {id}" labeling if you use it in UI
                stopIds: filteredIds,
                totalStops: filteredIds.length,
                completedStops: completed,
            };
        });

        console.log(
            "[mobile/routes] shaped:",
            shaped.length,
            "in",
            Date.now() - t0,
            "ms"
        );
        return NextResponse.json(shaped, {
            headers: { "Cache-Control": "no-store" },
        });
    } catch (e) {
        console.error("[mobile/routes] error:", e);
        // Return empty (200) so the mobile UI can still render gracefully
        return NextResponse.json([], { status: 200 });
    }
}