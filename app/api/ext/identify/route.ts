// app/api/ext/identify/route.ts
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const runtime = "nodejs";

const prisma = new PrismaClient();

// --- CORS helpers (so a Chrome extension can call this directly) ---
const ALLOW_ORIGIN = process.env.EXT_ORIGIN || "*";
const CORS_HEADERS = {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/* ======================= utilities ======================= */

function json(status: number, body: any) {
    return new NextResponse(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...CORS_HEADERS },
    });
}

function normalizeName(raw?: string | null) {
    const s = String(raw ?? "").trim().replace(/\s+/g, " ");
    if (!s) return { first: "", last: "" };
    const parts = s.split(" ");
    if (parts.length === 1) return { first: parts[0], last: "" };
    // Use first and last token; ignore middle names
    return { first: parts[0], last: parts[parts.length - 1] };
}

function digitsOnly(s?: string | null) {
    return String(s ?? "").replace(/\D+/g, "");
}

function normalizeAddress(s?: string | null) {
    // Lower, trim, collapse spaces, strip punctuation we don’t care about
    return String(s ?? "")
        .toLowerCase()
        .replace(/[.,#]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function parseUniteUsUrl(urlStr: string) {
    // Expects: https://app.uniteus.io/dashboard/cases/open/<CASE_ID>/contact/<CLIENT_ID>
    // Be tolerant to query/hash.
    try {
        const u = new URL(urlStr);
        const path = u.pathname.replace(/\/+$/, ""); // remove trailing slash
        // Regex captures the two UUID-like segments after /cases/open/ and /contact/
        const m =
            /\/cases\/open\/([0-9a-fA-F-]{10,})\/contact\/([0-9a-fA-F-]{10,})$/.exec(
                path
            );
        if (!m) return null;
        const [, caseId, clientId] = m;
        return { caseId, clientId };
    } catch {
        return null;
    }
}

type IdentifyInput = {
    name?: string | null;
    address?: string | null;
    phone?: string | null;
    url: string;
};

async function findUser(
    { name, address, phone }: IdentifyInput,
): Promise<{ userId: number; matchedBy: "name" | "phone" | "address"; debug: any }> {
    // We’ll try to find a *single* user, in order: name → phone → address.
    // If name yields multiple, use phone/address to narrow. Likewise for phone/address.

    const nameNorm = normalizeName(name);
    const phoneDigits = digitsOnly(phone);
    const addrNorm = normalizeAddress(address);

    // Helper to narrow a candidate list with phone/address if available
    const narrow = (cands: { id: number; phone: string | null; address: string; city: string; zip: string | null }[]) => {
        let list = [...cands];

        if (phoneDigits.length >= 7) {
            const last7 = phoneDigits.slice(-7);
            list = list.filter(c => digitsOnly(c.phone).endsWith(last7));
        }

        if (addrNorm) {
            // Require that the normalized DB address contains the primary street tokens
            // Extract number + first word as a minimal fingerprint if possible
            const tokens = addrNorm.split(" ");
            const num = tokens.find(t => /^\d+$/.test(t));
            const street = tokens.find(t => /^[a-z]/.test(t));
            const must = [num, street].filter(Boolean) as string[];
            if (must.length) {
                list = list.filter(c => {
                    const dbAddr = normalizeAddress(`${c.address} ${c.city ?? ""} ${c.zip ?? ""}`);
                    return must.every(t => dbAddr.includes(t));
                });
            } else {
                // fallback: loose contains
                list = list.filter(c => {
                    const dbAddr = normalizeAddress(`${c.address} ${c.city ?? ""} ${c.zip ?? ""}`);
                    return dbAddr.includes(addrNorm);
                });
            }
        }

        return list;
    };

    // 1) Try by NAME (first + last exact, case-insensitive)
    if (nameNorm.first && nameNorm.last) {
        const byName = await prisma.user.findMany({
            where: {
                first: { equals: nameNorm.first, mode: "insensitive" },
                last: { equals: nameNorm.last, mode: "insensitive" },
            },
            select: { id: true, phone: true, address: true, city: true, zip: true },
            take: 50,
        });

        if (byName.length === 1) {
            return { userId: byName[0].id, matchedBy: "name", debug: { initial: "name", candidates: byName.length } };
        }
        if (byName.length > 1) {
            const narrowed = narrow(byName);
            if (narrowed.length === 1) {
                return { userId: narrowed[0].id, matchedBy: "name", debug: { initial: "name", candidates: byName.length, narrowed: narrowed.length } };
            }
            if (narrowed.length > 1) {
                throw new Error(`Ambiguous: ${narrowed.length} users matched by name after narrowing`);
            }
            // else fall through to phone/address
        }
    }

    // 2) Try by PHONE (ends with last 7–10 digits)
    if (phoneDigits.length >= 7) {
        const last7 = phoneDigits.slice(-7);
        // We can’t easily do “endsWith digitsOnly(phone)” in SQL; fetch limited set by a broad contains/endsWith on raw,
        // then narrow in JS with a digits-only comparison.
        const possible = await prisma.user.findMany({
            where: {
                phone: { endsWith: last7 }, // helps index a bit; we still verify in JS
            },
            select: { id: true, phone: true, first: true, last: true, address: true, city: true, zip: true },
            take: 50,
        });

        const byPhone = possible.filter(u => digitsOnly(u.phone).endsWith(last7));

        if (byPhone.length === 1) {
            return { userId: byPhone[0].id, matchedBy: "phone", debug: { initial: "phone", candidates: byPhone.length } };
        }
        if (byPhone.length > 1) {
            const narrowed = narrow(byPhone);
            if (narrowed.length === 1) {
                return { userId: narrowed[0].id, matchedBy: "phone", debug: { initial: "phone", candidates: byPhone.length, narrowed: narrowed.length } };
            }
            throw new Error(`Ambiguous: ${byPhone.length} users matched by phone${addrNorm ? " (address provided but still ambiguous)" : ""}`);
        }
    }

    // 3) Try by ADDRESS (loose contains on normalized address)
    if (addrNorm) {
        // Use contains on a key fragment (street number + first token) to keep the candidate set small.
        const tokens = addrNorm.split(" ");
        const num = tokens.find(t => /^\d+$/.test(t));
        const street = tokens.find(t => /^[a-z]/.test(t));
        let byAddr = await prisma.user.findMany({
            where: num && street
                ? {
                    AND: [
                        { address: { contains: num, mode: "insensitive" } },
                        { address: { contains: street, mode: "insensitive" } },
                    ],
                }
                : {
                    address: { contains: tokens.slice(0, 3).join(" "), mode: "insensitive" },
                },
            select: { id: true, phone: true, address: true, city: true, zip: true },
            take: 100,
        });

        // JS-side normalization check
        byAddr = byAddr.filter(c => {
            const dbAddr = normalizeAddress(`${c.address} ${c.city ?? ""} ${c.zip ?? ""}`);
            // require both num and street if present
            if (num && !dbAddr.includes(num)) return false;
            if (street && !dbAddr.includes(street)) return false;
            // otherwise allow loose contains
            return true;
        });

        if (byAddr.length === 1) {
            return { userId: byAddr[0].id, matchedBy: "address", debug: { initial: "address", candidates: byAddr.length } };
        }
        if (byAddr.length > 1) {
            // Narrow further with phone if provided
            const narrowed = phoneDigits.length >= 7 ? byAddr.filter(c => digitsOnly(c.phone).endsWith(phoneDigits.slice(-7))) : byAddr;
            if (narrowed.length === 1) {
                return { userId: narrowed[0].id, matchedBy: "address", debug: { initial: "address", candidates: byAddr.length, narrowed: narrowed.length } };
            }
            throw new Error(`Ambiguous: ${byAddr.length} users matched by address`);
        }
    }

    throw new Error("No matching user found");
}

/* ======================= POST handler ======================= */

export async function POST(req: NextRequest) {
    try {
        const body = (await req.json()) as IdentifyInput | null;
        if (!body || typeof body !== "object") {
            return json(400, { ok: false, code: "bad_request", message: "Expected JSON body." });
        }

        const { name, address, phone, url } = body;

        if (!url || typeof url !== "string") {
            return json(400, { ok: false, code: "missing_url", message: "Field 'url' is required." });
        }

        // Identify the user
        let identified;
        try {
            identified = await findUser({ name, address, phone, url });
        } catch (e: any) {
            const msg = String(e?.message || e || "Identification failed");
            const code =
                msg.startsWith("Ambiguous") ? "ambiguous" :
                    msg.includes("No matching user") ? "not_found" : "identify_error";
            return json(404, { ok: false, code, message: msg, detail: { name, address, phone } });
        }

        // Parse Unite Us URL
        const parsed = parseUniteUsUrl(url);
        if (!parsed) {
            return json(422, {
                ok: false,
                code: "invalid_url_format",
                message: "URL did not match expected Unite Us pattern (/cases/open/{caseId}/contact/{clientId}).",
            });
        }

        // Save to DB
        await prisma.user.update({
            where: { id: identified.userId },
            data: {
                caseId: parsed.caseId,
                clientId: parsed.clientId,
            },
        });

        return json(200, {
            ok: true,
            userId: identified.userId,
            matchedBy: identified.matchedBy,
            saved: { caseId: parsed.caseId, clientId: parsed.clientId },
        });
    } catch (err: any) {
        console.error("[/api/ext/identify] Unhandled error:", err);
        return json(500, {
            ok: false,
            code: "server_error",
            message: "Unexpected server error.",
        });
    }
}