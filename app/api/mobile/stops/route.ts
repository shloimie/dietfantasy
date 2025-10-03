// app/api/mobile/stops/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";

/**
 * GET /api/mobile/stops
 * Returns: full stop objects for the given day.
 *
 * On DB error: returns [] with 200 JSON (and logs the error server-side).
 */
export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const day = searchParams.get("day") || "all";

        const stops = await prisma.stop.findMany({
            where: { day },
            orderBy: { id: "asc" },
        });

        const payload = stops.map(s => ({
            id: s.id,
            userId: s.userId ?? null,
            name: s.name ?? "",
            address: s.address ?? "",
            apt: s.apt ?? null,
            city: s.city ?? "",
            state: s.state ?? "",
            zip: s.zip ?? "",
            phone: s.phone ?? null,
            dislikes: s.dislikes ?? null,
            lat: s.lat ?? null,
            lng: s.lng ?? null,
            completed: Boolean(s.completed),
            proofUrl: s.proofUrl ?? null,
            assignedDriverId: s.assignedDriverId ?? null, // mobile ignores; useful for debugging
        }));

        return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
        console.error("[mobile/stops] GET error:", err);
        // Keep returning JSON to avoid NON_JSON_RESPONSE
        return NextResponse.json([], { status: 200, headers: { "Cache-Control": "no-store", "X-Error": "stops-db" } });
    }
}