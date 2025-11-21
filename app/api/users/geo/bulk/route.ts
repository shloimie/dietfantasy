// app/api/users/geo/bulk/route.ts
import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma"; // ⬅️ adjust path if yours differs

type Item = { id: number; lat: number; lng: number };

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => null);
        const items: Item[] = Array.isArray(body) ? body : body?.items;

        if (!Array.isArray(items) || !items.length) {
            return NextResponse.json({ error: "Body must be an array of {id,lat,lng}" }, { status: 400 });
        }

        const results: Array<{ id: number; ok: boolean; reason?: string }> = [];

        // NOTE: change model/field names to match your schema:
        //  - Model: prisma.user
        //  - Fields: lat, lng  (if your schema uses latitude/longitude, change below)
        for (const r of items) {
            const id = Number(r.id);
            const lat = Number(r.lat);
            const lng = Number(r.lng);
            if (!Number.isFinite(id) || !Number.isFinite(lat) || !Number.isFinite(lng)) {
                results.push({ id, ok: false, reason: "Invalid payload" });
                continue;
            }
            try {
                await prisma.user.update({
                    where: { id },
                    data: { lat, lng, geocodedAt: new Date() },
                });

                // Cascade coordinates to stops
                await prisma.stop.updateMany({
                    where: { userId: id },
                    data: { lat, lng },
                }).catch((e) => {
                    console.error(`Failed to cascade coords to stops for user ${id}:`, e);
                });

                results.push({ id, ok: true });
            } catch (e: any) {
                results.push({ id, ok: false, reason: e?.message || "DB error" });
            }
        }

        return NextResponse.json({ results });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
    }
}