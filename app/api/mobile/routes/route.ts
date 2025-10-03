// app/api/mobile/routes/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
// Adjust the import path if your prisma file lives elsewhere:
import prisma from "../../../../lib/prisma";

/**
 * GET /api/mobile/routes
 * Returns: [{ id, name, color, stopIds:number[] }]
 *
 * On DB error: returns [] with 200 JSON (and logs the error server-side).
 */
export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const day = searchParams.get("day") || "all";

        const drivers = await prisma.driver.findMany({
            where: { day },
            orderBy: { id: "asc" },
            select: { id: true, name: true, color: true, stopIds: true },
        });

        const payload = drivers.map(d => ({
            id: d.id,
            name: d.name,
            color: d.color,
            stopIds: Array.isArray(d.stopIds) ? d.stopIds : [],
        }));

        return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
        console.error("[mobile/routes] GET error:", err);
        // IMPORTANT: still return JSON so frontend doesn't see NON_JSON_RESPONSE
        return NextResponse.json([], { status: 200, headers: { "Cache-Control": "no-store", "X-Error": "routes-db" } });
    }
}