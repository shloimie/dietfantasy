import { NextResponse } from "next/server";
import prisma from "../../../lib/prisma";


const norm = (s) => String(s || "").trim().toLowerCase();

export async function GET() {
    const rows = await prisma.cityColor.findMany({ orderBy: [{ city: "asc" }] });
    return NextResponse.json(rows);
}

export async function POST(req) {
    const b = await req.json();
    const city = norm(b.city);
    const color = String(b.color || "").trim();
    if (!city || !/^#?[0-9a-fA-F]{6}$/.test(color.replace("#", ""))) {
        return NextResponse.json({ error: "Invalid city or color" }, { status: 400 });
    }
    const hex = color.startsWith("#") ? color : "#" + color;

    // No unique constraint required:
    const existing = await prisma.cityColor.findFirst({ where: { city } });
    let row;
    if (existing) {
        row = await prisma.cityColor.update({
            where: { id: existing.id },
            data: { color: hex, updated_at: new Date() },
        });
    } else {
        row = await prisma.cityColor.create({ data: { city, color: hex } });
    }

    return NextResponse.json(row, { status: 201 });
}