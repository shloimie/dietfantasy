// app/api/signatures/admin/[token]/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(
    _req: Request,
    ctx: { params: Promise<{ token: string }> }
) {
    try {
        const { token } = await ctx.params;
        if (!token) {
            return NextResponse.json({ error: "Missing token" }, { status: 400 });
        }

        // Your schema only has `sign_token`
        const user = await prisma.user.findFirst({
            where: { sign_token: token },
            select: {
                id: true,
                first: true,
                last: true,
                address: true,
                apt: true,
                city: true,
                state: true,
                zip: true,
            },
        });

        if (!user) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }

        // Adjust model name if yours is different (Signature vs Signatures)
        const sigs = await prisma.signature.findMany({
            where: { userId: user.id },
            orderBy: [{ slot: "asc" }, { signedAt: "asc" }],
            select: {
                slot: true,
                strokes: true,
                signedAt: true,
                ip: true,
                userAgent: true,
            },
        });

        const slots = Array.from(new Set(sigs.map((s) => s.slot))).sort((a, b) => a - b);

        return NextResponse.json({
            user,
            collected: sigs.length,
            slots,
            signatures: sigs,
        });
    } catch (err: any) {
        console.error("[admin token GET] error:", err);
        return NextResponse.json(
            { error: "Internal error", detail: err?.message },
            { status: 500 }
        );
    }
}

export async function DELETE(
    _req: Request,
    ctx: { params: Promise<{ token: string }> }
) {
    try {
        const { token } = await ctx.params;
        if (!token) {
            return NextResponse.json({ error: "Missing token" }, { status: 400 });
        }

        const user = await prisma.user.findFirst({
            where: { sign_token: token },
            select: { id: true },
        });

        if (!user) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }

        await prisma.signature.deleteMany({ where: { userId: user.id } });
        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error("[admin token DELETE] error:", err);
        return NextResponse.json(
            { error: "Internal error", detail: err?.message },
            { status: 500 }
        );
    }
}