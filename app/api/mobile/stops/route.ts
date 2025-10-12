// app/api/mobile/stops/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
export const dynamic = "force-dynamic";

// Build absolute URL on the server (Next 15: headers() must be awaited)
async function getServerBaseUrl() {
    const { headers } = await import("next/headers");
    const h = await headers();
    const proto = h.get("x-forwarded-proto") ?? "http";
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
    return `${proto}://${host}`;
}

export async function GET() {
    const t0 = Date.now();
    console.log("[stops API] GET start");

    // 1) Load stops (manual completion only)
    let stops: {
        id: number;
        userId: number;
        order: number | null;
        completed: boolean;
        name: string | null;
        address: string | null;
        apt: string | null;
        city: string | null;
        state: string | null;
        zip: string | null;
        phone: string | null;
        dislikes: string | null;
        lat: number | null;
        lng: number | null;
    }[] = [];

    try {
        stops = await prisma.stop.findMany({
            orderBy: [{ day: "asc" }, { order: "asc" }],
            select: {
                id: true,
                userId: true,
                order: true,
                completed: true, // manual-only
                name: true,
                address: true,
                apt: true,
                city: true,
                state: true,
                zip: true,
                phone: true,
                dislikes: true,
                lat: true,
                lng: true,
            },
        });
        console.log("[stops API] stops:", stops.length);
    } catch (e) {
        console.error("[stops API] prisma.stop.findMany error:", e);
        return NextResponse.json({ ok: false, error: "stop query failed" }, { status: 500 });
    }

    // 2) Minimal users (for name + sign_token)
    const userIds = Array.from(new Set(stops.map((s) => s.userId)));
    console.log("[stops API] unique userIds:", userIds.length);

    let users:
        | { id: number; first: string | null; last: string | null; sign_token: string | null }[]
        | [] = [];
    try {
        users = userIds.length
            ? await prisma.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, first: true, last: true, sign_token: true },
            })
            : [];
        console.log("[stops API] users fetched:", users.length);
    } catch (e) {
        console.error("[stops API] prisma.user.findMany error:", e);
        users = [];
    }
    const userMap = new Map(users.map((u) => [u.id, u]));

    // 3) Signature counts — reuse the SAME endpoint as the main site
    //    This guarantees both UIs show identical numbers.
    let sigMap = new Map<number, number>();
    try {
        const base = await getServerBaseUrl();
        const url = `${base}/api/signatures/status`;
        console.log("[stops API] fetching signature counts from:", url);

        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) {
            const txt = await res.text().catch(() => "");
            console.warn("[stops API] signatures/status non-200:", res.status, txt.slice(0, 200));
        } else {
            const rows: { userId: number; collected: number }[] = await res.json();
            console.log("[stops API] signatures/status rows:", rows.length);
            sigMap = new Map(rows.map((r) => [Number(r.userId), Number(r.collected)]));
        }
    } catch (e) {
        console.warn("[stops API] signatures/status fetch failed, falling back to 0s:", e);
    }

    // 4) Shape response (DO NOT auto-complete from signatures)
    const result = stops.map((s) => {
        const u = userMap.get(s.userId);
        const sigCollected = sigMap.get(s.userId) ?? 0;
        return {
            ...s,
            user: u ? { id: u.id, first: u.first, last: u.last } : null,
            signToken: u?.sign_token ?? null,
            sigCollected,
        };
    });

    console.log("[stops API] shaped:", result.length, "in", Date.now() - t0, "ms");
    const resp = NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    resp.headers.set("X-Stops", String(result.length));
    resp.headers.set("X-Sigs-Source", "/api/signatures/status");
    return resp;
}