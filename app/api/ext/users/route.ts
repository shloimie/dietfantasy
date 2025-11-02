// app/api/ext/users/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Allow your Chrome extension to call this directly
const ALLOW_ORIGIN = process.env.EXT_ORIGIN || "*";
const CORS_HEADERS = {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// --- Preflight ---
export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// --- GET /api/ext/users ---
// Shape returned per user:
// {
//   name: string,
//   hasSignature: boolean,
//   billings: any[] | string,   // preserves original JSON or raw string if malformed
//   paused: boolean,
//   bill: boolean,
//   delivery: boolean,
//   clientId: string | null,
//   caseId: string | null,
//   id: number                  // helpful for extension correlation (kept minimal)
// }
export async function GET() {
    try {
        // Pull core user fields (no address/geo for speed)
        const users = await prisma.user.findMany({
            orderBy: [{ city: "asc" }, { last: "asc" }],
            select: {
                id: true,
                first: true,
                last: true,
                paused: true,
                bill: true,
                delivery: true,
                billings: true,
                clientId: true,
                caseId: true,
            },
        });

        // Build a map of users who have signatures (uses Signature model if present)
        // Falls back gracefully if the table doesn't exist.
        let sigMap: Record<number, boolean> = {};
        try {
            const byUser = await prisma.signature.groupBy({
                by: ["userId"],
                _count: { userId: true },
            });
            sigMap = byUser.reduce((acc, row) => {
                acc[row.userId as number] = (row._count?.userId ?? 0) > 0;
                return acc;
            }, {} as Record<number, boolean>);
        } catch {
            // If there's no Signature model/table, just default to false for all.
            sigMap = {};
        }

        // helper to parse billings but preserve raw on error
        const parseBillings = (raw: any) => {
            if (raw == null) return [];
            try {
                if (typeof raw === "string") {
                    const t = raw.trim();
                    if (!t) return [];
                    return JSON.parse(t);
                }
                return raw; // already JSON
            } catch {
                return String(raw); // keep malformed content as string
            }
        };

        const payload = users.map((u) => ({
            id: u.id,
            name: `${(u.first || "").trim()} ${(u.last || "").trim()}`.trim() || "(Unnamed)",
            hasSignature: !!sigMap[u.id],
            billings: parseBillings(u.billings),
            paused: !!u.paused,
            bill: u.bill == null ? true : !!u.bill,           // default true if missing
            delivery: u.delivery == null ? true : !!u.delivery, // default true if missing
            clientId: u.clientId ?? null,
            caseId: u.caseId ?? null,
        }));

        return NextResponse.json(payload, { status: 200, headers: CORS_HEADERS });
    } catch (e: any) {
        console.error("GET /api/ext/users failed:", e?.message || e);
        return NextResponse.json(
            { error: "Failed to load users" },
            { status: 500, headers: CORS_HEADERS }
        );
    }
}