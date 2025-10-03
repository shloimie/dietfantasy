// app/api/mobile/stop/update/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import prisma from "../../../../../lib/prisma";

/**
 * POST /api/mobile/stop/update
 * Body: { stopId, completed?: boolean, proofUrl?: string }
 * Returns: { ok: true, stop }
 *
 * If the payload is invalid or the row is not found, returns JSON error with a proper 4xx/5xx code.
 * (Your mobile frontend already handles HTTP errors.)
 */
export async function POST(req) {
    try {
        const body = await req.json().catch(() => ({}));
        const stopId = Number(body?.stopId);
        if (!Number.isFinite(stopId)) {
            return NextResponse.json({ error: "Invalid stopId" }, { status: 400 });
        }

        const data = {};
        if (typeof body?.completed === "boolean") data.completed = body.completed;
        if (typeof body?.proofUrl === "string") data.proofUrl = body.proofUrl;

        // If no fields provided, just return the existing stop (mobile expects JSON)
        if (Object.keys(data).length === 0) {
            const existing = await prisma.stop.findUnique({ where: { id: stopId } });
            if (!existing) return NextResponse.json({ error: "Stop not found" }, { status: 404 });
            return NextResponse.json({ ok: true, stop: existing }, { headers: { "Cache-Control": "no-store" } });
        }

        // Update
        const updated = await prisma.stop.update({
            where: { id: stopId },
            data,
        });

        return NextResponse.json({ ok: true, stop: updated }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
        console.error("[mobile/stop/update] POST error:", err);
        return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
}