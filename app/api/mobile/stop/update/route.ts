import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Body = {
    stopId?: string | number;
    completed?: boolean;
    proofUrl?: string | null;
};

export async function POST(req: Request) {
    let payload: Body;
    try {
        payload = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const stopIdNum = Number(payload.stopId);
    if (!stopIdNum || Number.isNaN(stopIdNum)) {
        return NextResponse.json({ error: "Invalid stopId" }, { status: 400 });
    }

    const data: any = {};
    if (typeof payload.completed === "boolean") data.completed = payload.completed;
    if (typeof payload.proofUrl === "string" || payload.proofUrl === null) data.proofUrl = payload.proofUrl;

    if (!Object.keys(data).length) {
        return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    await prisma.stop.update({
        where: { id: stopIdNum },
        data,
    });

    return NextResponse.json({ ok: true });
}