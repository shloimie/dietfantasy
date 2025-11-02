// app/api/ext/billings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const runtime = "nodejs";

const prisma = new PrismaClient();

/* ======================= CORS ======================= */
const ALLOW_ORIGIN = process.env.EXT_ORIGIN || "*";
const CORS_HEADERS = {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/* ======================= Helpers ======================= */
function json(status: number, body: any) {
    return new NextResponse(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...CORS_HEADERS },
    });
}

function toISODateOnly(raw: unknown): string {
    if (typeof raw !== "string" || !raw.trim()) throw new Error("Missing date");
    const d = new Date(raw);
    if (isNaN(d.getTime())) throw new Error(`Invalid date: ${raw}`);
    // store as YYYY-MM-DD (no time)
    return d.toISOString().slice(0, 10);
}

function normalizeUserId(raw: unknown): number {
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string" && raw.trim() !== "" && !isNaN(Number(raw))) return Number(raw);
    throw new Error("Invalid or missing userId");
}

/* Shape of one billing entry we append
   {
     start: "YYYY-MM-DD",
     end: "YYYY-MM-DD",
     addedAt: ISOString,
     source?: string,
     meta?: any
   }
*/

/* ======================= POST ======================= */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));

        const userId = normalizeUserId(body.userId ?? body.userid ?? body.id);
        const start = toISODateOnly(body.startDate ?? body.start ?? body.from);
        const end = toISODateOnly(body.endDate ?? body.end ?? body.to);

        if (end < start) {
            return json(400, { ok: false, error: "endDate must be on/after startDate" });
        }

        const entry: any = {
            start,
            end,
            addedAt: new Date().toISOString(),
        };

        // Optional passthroughs if you send them
        if (typeof body.source === "string") entry.source = body.source;
        if (body.meta != null) entry.meta = body.meta;

        // Transaction: load → append → save
        const updated = await prisma.$transaction(async (tx) => {
            const u = await tx.user.findUnique({
                where: { id: userId },
                select: { id: true, billings: true },
            });

            if (!u) throw new Error("User not found");

            const current = Array.isArray(u.billings) ? u.billings : [];
            const next = [...current, entry];

            const saved = await tx.user.update({
                where: { id: userId },
                data: { billings: next as any },
                select: { id: true, billings: true },
            });

            return saved;
        });

        return json(200, {
            ok: true,
            userId: updated.id,
            appended: entry,
            totalBillings: Array.isArray(updated.billings) ? updated.billings.length : null,
        });
    } catch (err: any) {
        const msg = typeof err?.message === "string" ? err.message : "Unexpected error";
        const status = /not found/i.test(msg) ? 404 : 400;
        return json(status, { ok: false, error: msg });
    }
}