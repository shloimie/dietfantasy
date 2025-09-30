import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(req: Request) {
    const url = new URL(req.url);
    const routeId = url.searchParams.get("routeId"); // optional filter

    const where = routeId ? { routeId: Number(routeId) } : {};
    const stops = await prisma.stop.findMany({
        where,
        orderBy: [{ routeId: "asc" }, { order: "asc" }],
    });

    const data = stops.map((s) => ({
        id: String(s.id),
        order: s.order,
        name: s.name,
        address: s.address,
        city: s.city,
        state: s.state,
        zip: s.zip,
        phone: s.phone ?? "",
        dislikes: s.dislikes ?? "",
        completed: Boolean(s.completed),
        proofUrl: s.proofUrl ?? "",
    }));

    return NextResponse.json(data);
}