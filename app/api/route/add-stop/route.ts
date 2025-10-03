// app/api/route/add-stop/route.ts
import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const rId = Number(body?.routeId);
        const uId = Number(body?.userId);
        if (!Number.isFinite(rId) || !Number.isFinite(uId)) {
            return NextResponse.json({ error: "Invalid routeId or userId" }, { status: 400 });
        }

        // If Stop has a relation `route` → Route, filter via the relation:
        const lastStop = await prisma.stop.findFirst({
            where: { route: { id: rId } },     // ← was: where: { routeId }
            orderBy: { order: "desc" },
        });

        const nextOrder = (lastStop?.order ?? 0) + 1;

        const created = await prisma.stop.create({
            data: {
                order: nextOrder,
                route: { connect: { id: rId } },  // relation connect
                user:  { connect: { id: uId } },
            },
            include: { route: true, user: true },
        });

        return NextResponse.json({ ok: true, stop: created }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
        console.error("[route/add-stop] POST error:", err);
        return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
}