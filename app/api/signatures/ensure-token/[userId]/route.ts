// app/api/signatures/ensure-token/[userId]/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();

export async function POST(
    _req: Request,
    ctx: { params: Promise<{ userId: string }> }  // <- params is a Promise now
) {
    const { userId } = await ctx.params;          // <- await it
    const id = Number(userId);
    if (!Number.isFinite(id)) {
        return NextResponse.json({ error: "Bad userId" }, { status: 400 });
    }

    const found = await prisma.user.findUnique({
        where: { id },
        select: { sign_token: true },
    });

    const token = found?.sign_token ?? randomUUID();

    if (!found?.sign_token) {
        await prisma.user.update({ where: { id }, data: { sign_token: token } });
    }

    return NextResponse.json({ sign_token: token });
}