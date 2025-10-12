// app/api/mobile/stops/route.ts
import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/stops?driverId=123&day=all
 *
 * - If driverId is provided: returns that driver's stops (ordered), as a flat array.
 * - If driverId is omitted: returns all stops for the day (ordered), as a flat array.
 * - Optional ?day= (default "all") narrows by Stop.day when returning all or driver-filtered stops.
 *
 * Response: Stop[] (no wrapper object) — matches existing lib/api.js callers.
 */
export async function GET(req: Request) {
    const url = new URL(req.url);
    const day = (url.searchParams.get("day") ?? "all").toLowerCase();
    const driverIdParam = url.searchParams.get("driverId");

    console.log("[/api/mobile/stops] GET", { day, driverIdParam }); // DEBUG

    // Build base where clause
    const where: any = {};
    if (day !== "all") where.day = day;

    // If driverId provided, prefer using Driver.stopIds to preserve intended order
    if (driverIdParam) {
        const driverId = Number(driverIdParam);
        if (!Number.isFinite(driverId)) {
            return NextResponse.json({ error: "Invalid driverId" }, { status: 400 });
        }

        // Fetch driver's ordered stopIds
        const driver = await prisma.driver.findUnique({
            where: { id: driverId },
            select: { stopIds: true },
        });

        const orderedIds: number[] = Array.isArray(driver?.stopIds)
            ? (driver!.stopIds as unknown[])
                .map((n) => Number(n))
                .filter((n) => Number.isFinite(n))
            : [];

        if (!orderedIds.length) {
            // No stops for this driver — return empty array (contract expects an array)
            return NextResponse.json([], { headers: { "Cache-Control": "no-store" } });
        }

        // Get those stops (optionally constrained by day)
        const stops = await prisma.stop.findMany({
            where: { ...where, id: { in: orderedIds } },
            select: {
                id: true,
                userId: true,
                name: true,
                address: true,
                apt: true,
                city: true,
                state: true,
                zip: true,
                phone: true,
                lat: true,
                lng: true,
                order: true,
                completed: true,
                proofUrl: true,
            },
        });

        // Reorder to match Driver.stopIds order
        const byId = new Map(stops.map((s) => [s.id, s]));
        const ordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);

        console.log("[/api/mobile/stops] return (by driver):", ordered.length); // DEBUG
        return NextResponse.json(ordered, { headers: { "Cache-Control": "no-store" } });
    }

    // No driverId → return ALL stops for the day (flat array), ordered for stable UI
    const all = await prisma.stop.findMany({
        where,
        orderBy: [
            { assignedDriverId: "asc" },
            { order: "asc" },
            { id: "asc" },
        ],
        select: {
            id: true,
            userId: true,
            name: true,
            address: true,
            apt: true,
            city: true,
            state: true,
            zip: true,
            phone: true,
            lat: true,
            lng: true,
            order: true,
            completed: true,
            proofUrl: true,
        },
    });

    console.log("[/api/mobile/stops] return (all day):", all.length); // DEBUG
    return NextResponse.json(all, { headers: { "Cache-Control": "no-store" } });
}