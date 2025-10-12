// app/api/mobile/stop/complete/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export async function POST(req: Request) {
    const body = await req.json().catch(() => null);
    const userId = Number(body?.userId);
    const stopId = Number(body?.stopId);
    const completed = Boolean(body?.completed);

    if (!Number.isFinite(userId) || !Number.isFinite(stopId)) {
        return NextResponse.json({ ok: false, error: "Bad payload" }, { status: 400 });
    }

    const updated = await prisma.stop.update({
        where: { id: stopId },
        data: { completed },
        select: { id: true, completed: true },
    });

    return NextResponse.json({ ok: true, stop: updated });
}