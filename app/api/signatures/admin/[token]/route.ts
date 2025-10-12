// app/api/signatures/admin/[token]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const runtime = "nodejs";

const prisma = new PrismaClient();

function noStore(res: NextResponse) {
    res.headers.set("Cache-Control", "no-store");
    return res;
}

/** GET: return user info + signatures for this token */
export async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ token: string }> }
) {
    try {
        const { token } = await ctx.params;

        const user = await prisma.user.findUnique({
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
            return noStore(
                NextResponse.json({ error: "Not found" }, { status: 404 })
            );
        }

        const sigs = await prisma.signature.findMany({
            where: { userId: user.id },
            select: {
                slot: true,
                strokes: true,      // JSON[] of strokes as saved by your signer
                signedAt: true,
                ip: true,
                userAgent: true,
            },
            orderBy: { slot: "asc" },
        });

        return noStore(
            NextResponse.json({
                user,
                collected: sigs.length,
                slots: sigs.map((s) => s.slot),
                signatures: sigs,
            })
        );
    } catch (e: any) {
        console.error("admin/[token] GET error:", e);
        return noStore(
            NextResponse.json({ error: "Server error" }, { status: 500 })
        );
    }
}

/** DELETE: remove ALL signatures for this token */
export async function DELETE(
    _req: NextRequest,
    ctx: { params: Promise<{ token: string }> }
) {
    try {
        const { token } = await ctx.params;

        const user = await prisma.user.findUnique({
            where: { sign_token: token },
            select: { id: true },
        });

        if (!user) {
            return noStore(
                NextResponse.json({ error: "Not found" }, { status: 404 })
            );
        }

        await prisma.signature.deleteMany({ where: { userId: user.id } });

        return noStore(NextResponse.json({ ok: true, deleted: true }));
    } catch (e: any) {
        console.error("admin/[token] DELETE error:", e);
        return noStore(
            NextResponse.json({ error: "Server error" }, { status: 500 })
        );
    }
}