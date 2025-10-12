import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ token: string }> } // Next 15: params is a Promise
) {
    const { token } = await ctx.params;

    const user = await prisma.user.findFirst({
        where: { sign_token: token },
        select: { id: true, first: true, last: true },
    });
    if (!user) return new NextResponse("Not found", { status: 404 });

    const sigs = await prisma.signature.findMany({
        where: { userId: user.id },
        select: { slot: true },
        orderBy: { slot: "asc" },
    });

    return NextResponse.json({
        user,
        collected: sigs.length,
        slots: sigs.map((s) => s.slot),
    });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
    const { token } = await ctx.params;
    const user = await prisma.user.findFirst({
        where: { sign_token: token },
        select: { id: true },
    });
    if (!user) return new NextResponse("Not found", { status: 404 });

    const body = await req.json().catch(() => null);
    const slot = Number(body?.slot);
    const strokes = body?.strokes;

    if (![1, 2, 3, 4, 5].includes(slot)) {
        return new NextResponse("Invalid slot", { status: 400 });
    }
    if (!Array.isArray(strokes) || strokes.length === 0) {
        return new NextResponse("Invalid strokes", { status: 400 });
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
    const ua = req.headers.get("user-agent") || undefined;

    await prisma.signature.upsert({
        where: { userId_slot: { userId: user.id, slot } },
        update: { strokes, userAgent: ua, ip: ip ?? null },
        create: { userId: user.id, slot, strokes, userAgent: ua, ip: ip ?? null },
    });

    const after = await prisma.signature.findMany({
        where: { userId: user.id },
        select: { slot: true },
        orderBy: { slot: "asc" },
    });

    return NextResponse.json({
        ok: true,
        collected: after.length,
        slots: after.map((s) => s.slot),
    });
}