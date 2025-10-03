// app/api/route/reassign/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";

const sid = (v) => (v === null || v === undefined ? "" : String(v));

export async function POST(req) {
    try {
        const body = await req.json();
        const day = body?.day || "all";
        const toDriverId = Number(body?.toDriverId);
        const stopId = Number(body?.stopId ?? body?.id);
        const userId = Number(body?.userId ?? NaN);

        if (!Number.isFinite(toDriverId) || (!Number.isFinite(stopId) && !Number.isFinite(userId))) {
            return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
        }

        // Resolve stop by stopId or userId
        const stop = Number.isFinite(stopId)
            ? await prisma.stop.findFirst({ where: { id: stopId, day } })
            : await prisma.stop.findFirst({ where: { userId, day } });

        if (!stop) return NextResponse.json({ error: "Stop not found for this day" }, { status: 404 });

        // Fetch drivers for day
        const drivers = await prisma.driver.findMany({ where: { day } });
        const toDriver = drivers.find((d) => d.id === toDriverId);
        if (!toDriver) return NextResponse.json({ error: "Target driver not found" }, { status: 404 });

        // Remove from any current owner (filter stale duplicates too)
        for (const d of drivers) {
            const arr = Array.isArray(d.stopIds) ? d.stopIds : [];
            const next = arr.filter((v) => sid(v) !== sid(stop.id));
            if (next.length !== arr.length) {
                await prisma.driver.update({ where: { id: d.id }, data: { stopIds: next } });
            }
        }

        // Add once to target
        const tgt = Array.isArray(toDriver.stopIds) ? [...toDriver.stopIds] : [];
        if (!tgt.map(sid).includes(sid(stop.id))) tgt.push(stop.id);
        await prisma.driver.update({ where: { id: toDriver.id }, data: { stopIds: tgt } });

        // Mirror convenience
        await prisma.stop.update({ where: { id: stop.id }, data: { assignedDriverId: toDriver.id } });

        return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
        console.error("reassign error", e);
        return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
}