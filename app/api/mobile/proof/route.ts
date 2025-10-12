import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function okAuth(req) {
    const auth = req.headers.get("authorization");
    const secret = process.env.MOBILE_API_SECRET;
    if (auth && secret && auth.toLowerCase().startsWith("bearer ")) {
        return auth.slice(7).trim() === secret;
    }
    // same-origin cookie session also allowed
    return true;
}

export async function POST(req) {
    try {
        if (!okAuth(req)) {
            return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        }

        const { stopId, url } = await req.json();
        if (!stopId || !url) {
            return NextResponse.json({ ok: false, error: "Missing stopId or url" }, { status: 400 });
        }

        // find stop -> userId
        const stop = await prisma.stop.findUnique({
            where: { id: Number(stopId) },
            select: { id: true, userId: true },
        });
        if (!stop) return NextResponse.json({ ok: false, error: "Stop not found" }, { status: 404 });
        if (!stop.userId) return NextResponse.json({ ok: false, error: "Stop has no userId" }, { status: 422 });

        const createdAt = new Date().toISOString();
        const current = await prisma.user.findUnique({
            where: { id: stop.userId },
            select: { visits: true },
        });

        const visits = Array.isArray(current?.visits) ? current.visits : [];
        visits.push({ stopId: stop.id, url, createdAt });

        // write to User.visits
        await prisma.user.update({
            where: { id: stop.userId },
            data: { visits },
        });

        // optional: mirror last proof onto Stop for legacy code
        await prisma.stop.update({
            where: { id: stop.id },
            data: { proofUrl: url },
        });

        return NextResponse.json({ ok: true, proof: { url, createdAt, expiresAt: null } });
    } catch (e) {
        console.error("[/api/mobile/proof] Error:", e);
        return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
    }
}