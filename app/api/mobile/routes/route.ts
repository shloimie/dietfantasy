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
 *
 * Supports ?day=<monday|tuesday|...|all>
 * When a specific day is requested, we also include drivers with day="all"
 * so generation done with day="all" still powers the mobile view.
 */
export async function GET(req: Request) {
    const t0 = Date.now();
    console.log("[mobile/routes] GET start");

    try {
        const { searchParams } = new URL(req.url);
        const dayParam = (searchParams.get("day") ?? "all").toLowerCase();

        // 1) Fetch drivers (include day="all" when a specific day is requested)
        const where =
            dayParam === "all"
                ? {}
                : {
                    OR: [{ day: dayParam }, { day: "all" }],
                } as const;

        const drivers = await prisma.driver.findMany({
            where,
            orderBy: { id: "asc" },
            select: { id: true, name: true, color: true, stopIds: true },
        });
        console.log("[mobile/routes] drivers:", drivers.length, "day:", dayParam);

        // 2) Collect unique stopIds
        const allStopIds = Array.from(
            new Set(
                drivers.flatMap((d) =>
                    Array.isArray(d.stopIds)
                        ? (d.stopIds as unknown[])
                            .map((n) => Number(n))
                            .filter(Number.isFinite)
                        : []
                )
            )
        );
        console.log("[mobile/routes] unique stopIds:", allStopIds.length);

        // 3) Load minimal stop info to compute progress
        const stops: StopLite[] = allStopIds.length
            ? ((await prisma.stop.findMany({
                where: { id: { in: allStopIds } },
                select: { id: true, completed: true },
            })) as StopLite[])
            : [];

        const stopById = new Map<number, StopLite>();
        for (const s of stops) stopById.set(s.id, s);

        // 4) Shape per driver
        const shaped = drivers.map((d) => {
            const rawIds = Array.isArray(d.stopIds) ? (d.stopIds as unknown[]) : [];
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

        // 5) Hide drivers with no stops so mobile only shows live routes
        const activeOnly = shaped.filter((r) => r.totalStops > 0);

        console.log(
            "[mobile/routes] shaped(active):",
            activeOnly.length,
            "in",
            Date.now() - t0,
            "ms"
        );

        return NextResponse.json(activeOnly, {
            headers: { "Cache-Control": "no-store" },
        });
    } catch (e) {
        console.error("[mobile/routes] error:", e);
        // Return empty (200) so the mobile UI can still render gracefully
        return NextResponse.json([], { status: 200 });
    }
}