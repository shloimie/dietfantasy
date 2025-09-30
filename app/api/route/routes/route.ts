// app/api/route/routes/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function normalizeDay(raw?: string | null) {
    const s = String(raw ?? "all").toLowerCase().trim();
    const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
    return days.includes(s) ? s : "all";
}

export async function GET(req: Request) {
    const url = new URL(req.url);
    const day = normalizeDay(url.searchParams.get("day"));

    const routes = await prisma.driverRoute.findMany({
        where: { day },
        orderBy: { driverNumber: "asc" },
        include: { stops: { orderBy: { order: "asc" } } },
    });

    return NextResponse.json({ day, routes });
}