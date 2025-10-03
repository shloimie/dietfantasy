// app/api/route/auto-assign/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";

export async function POST(req) {
    try {
        const b = await req.json();
        const day = b?.day || "all";
        const newStops = Array.isArray(b?.newStops) ? b.newStops : [];

        if (!newStops.length) {
            return NextResponse.json({ ok: true, created: 0 });
        }

        const data = newStops.map((s) => ({
            day,
            userId: s.userId ?? null,
            order: null,
            name: s.name || "Unnamed",
            address: s.address || "",
            apt: s.apt ?? null,
            city: s.city || "",
            state: s.state || "",
            zip: s.zip || "",
            phone: s.phone ?? null,
            dislikes: s.dislikes ?? null,
            lat: Number.isFinite(Number(s.lat)) ? Number(s.lat) : null,
            lng: Number.isFinite(Number(s.lng)) ? Number(s.lng) : null,
            completed: false,
            proofUrl: null,
            assignedDriverId: null,
        }));

        await prisma.stop.createMany({ data });

        return NextResponse.json({ ok: true, created: data.length });
    } catch (e) {
        console.error("auto-assign error", e);
        return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
}