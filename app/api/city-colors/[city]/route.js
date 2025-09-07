import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function DELETE(_req, context) {
    const { params } = await context; // Next 15 requires awaiting context
    const city = String(params.city || "").toLowerCase();
    await prisma.cityColor.deleteMany({ where: { city } });
    return NextResponse.json({ ok: true });
}