import React from "react";
import { Button, IconButton, Tooltip, CircularProgress } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DoneIcon from "@mui/icons-material/Done";

export default function UsersTable({
                                       users,
                                       onSort,
                                       sortKey,
                                       sortAsc,
                                       getCityColor,
                                       onEdit,
                                       onDelete,
                                       showDetails = false,
                                   }) {
    // Signature counts (userId -> number)
    const [sigCount, setSigCount] = React.useState({});
    // Cache of tokens we might fetch on-demand
    const [tokenPatch, setTokenPatch] = React.useState({});
    // Track copied state by user ID
    const [copiedUsers, setCopiedUsers] = React.useState({});
    // Track loading state by user ID
    const [loadingUsers, setLoadingUsers] = React.useState({});

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch("/api/signatures/status", { cache: "no-store" });
                if (!res.ok) {
                    console.error(`Failed to fetch signatures: ${res.status}`);
                    return;
                }
                const rows = await res.json(); // [{ userId, collected }] or Prisma _count
                if (cancelled) return;
                const map = {};
                for (const r of rows) map[r.userId] = r._count?.userId ?? r.collected ?? 0;
                setSigCount(map);
            } catch (err) {
                console.error("Error fetching signatures:", err);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // Replace getToken with this robust version
    const getToken = async (u) => {
        const existing =
            tokenPatch[u.id] ??
            u.signToken ??
            u.sign_token ??
            u.token ??
            null;

        if (existing) {
            console.log(`[DEBUG] Using cached/existing token for user ${u.id}: ${existing}`);
            return existing;
        }

        setLoadingUsers((prev) => ({ ...prev, [u.id]: true }));
        try {
            const tryLegacy = async () => {
                const res = await fetch(`/api/signatures/ensure-token/${u.id}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({}),
                });
                if (!res.ok) throw new Error(`legacy ensure-token failed ${res.status}`);
                const data = await res.json();
                const token =
                    data.sign_token ??
                    data.signToken ??
                    data.token ??
                    null;
                if (!token) throw new Error("legacy ensure-token: no token in response");
                return token;
            };

            const tryBody = async () => {
                const res = await fetch(`/api/signatures/ensure-token`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ userId: u.id }),
                });
                if (!res.ok) throw new Error(`body ensure-token failed ${res.status}`);
                const data = await res.json();
                const token =
                    data.sign_token ??
                    data.signToken ??
                    data.token ??
                    null;
                if (!token) throw new Error("body ensure-token: no token in response");
                return token;
            };

            let token = null;
            try {
                token = await tryLegacy();
            } catch (e1) {
                console.warn("[DEBUG] Legacy ensure-token failed, trying body endpoint:", e1?.message);
                token = await tryBody();
            }

            setTokenPatch((m) => ({ ...m, [u.id]: token }));
            console.log(`[DEBUG] Ensured token for user ${u.id}: ${token}`);
            return token;
        } catch (err) {
            console.error("[DEBUG] getToken failed:", err);
            return null;
        } finally {
            setLoadingUsers((prev) => ({ ...prev, [u.id]: false }));
        }
    };

    const geoCount = Array.isArray(users)
        ? users.filter((u) => (u.lat ?? u.latitude) != null && (u.lng ?? u.longitude) != null).length
        : 0;

    const signColumn = {
        key: "signatures",
        label: "SIGN",
        render: (u) => {
            const collected = sigCount[u.id] ?? 0;
            const done = collected >= 5;
            const isCopied = copiedUsers[u.id] || false;
            const isLoading = loadingUsers[u.id] || false;

            const handleClick = async () => {
                console.log(`[DEBUG] Clicked SIGN for user ${u.id}`);
                if (isLoading) return;
                setLoadingUsers((prev) => ({ ...prev, [u.id]: true }));

                const token = await getToken(u);
                setLoadingUsers((prev) => ({ ...prev, [u.id]: false }));
                if (!token) {
                    alert("Could not create a signature link for this user. Please try again.");
                    return;
                }

                const base = `${window.location.origin}/sign/${token}`;
                if (done) {
                    const viewerUrl = `${base}/view`;
                    try {
                        const head = await fetch(viewerUrl, { method: "HEAD" });
                        const urlToOpen = head.ok ? viewerUrl : base;
                        console.log(`[DEBUG] Opening ${head.ok ? "viewer" : "fallback"} URL for user ${u.id}: ${urlToOpen}`);
                        window.open(urlToOpen, "_blank", "noopener,noreferrer");
                    } catch (e) {
                        console.warn("[DEBUG] HEAD preflight failed, opening fallback:", e?.message);
                        window.open(base, "_blank", "noopener,noreferrer");
                    }
                } else {
                    try {
                        await navigator.clipboard.writeText(base);
                        setCopiedUsers((prev) => ({ ...prev, [u.id]: true }));
                        setTimeout(() => {
                            setCopiedUsers((prev) => ({ ...prev, [u.id]: false }));
                        }, 2000);
                        console.log(`[DEBUG] Copied link for user ${u.id}: ${base}`);
                    } catch (err) {
                        console.error("Failed to copy link:", err);
                        alert("Failed to copy link to clipboard.");
                    }
                }
            };

            return (
                <Tooltip title={done ? "View completed signatures" : isCopied ? "Link Copied! 🎉" : "Copy public signature link"}>
                    <IconButton
                        size="small"
                        onClick={handleClick}
                        aria-label={done ? "Open signatures" : "Copy signature link"}
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <CircularProgress size={20} color="primary" />
                        ) : done ? (
                            <DoneIcon style={{ color: "#4caf50", transform: "scale(1.2)", transition: "transform 0.2s" }} />
                        ) : isCopied ? (
                            <DoneIcon
                                style={{
                                    color: "#4caf50",
                                    transform: "scale(1.2)",
                                    transition: "transform 0.2s",
                                }}
                            />
                        ) : (
                            <ContentCopyIcon
                                style={{
                                    color: "#1976d2",
                                    transform: "scale(1)",
                                    transition: "transform 0.2s",
                                }}
                            />
                        )}
                    </IconButton>
                </Tooltip>
            );
        },
    };

    const baseColumns = [
        { key: "first", label: "FIRST", render: (u) => u.first ?? "" },
        { key: "last", label: "LAST", render: (u) => u.last ?? "" },
        signColumn,
        { key: "address", label: "ADDRESS", render: (u) => u.address ?? "" },
        { key: "apt", label: "APT", render: (u) => u.apt ?? "" },
        {
            key: "city",
            label: "CITY",
            render: (u) => (
                <span style={{ color: getCityColor(u.city) || "inherit", fontWeight: 600 }}>{u.city}</span>
            ),
        },
        {
            key: "dislikes",
            label: "DISLIKES",
            render: (u) => (
                <div
                    style={{
                        minWidth: "30ch",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        overflowWrap: "anywhere",
                    }}
                >
                    {u.dislikes ?? ""}
                </div>
            ),
        },
    ];

    const detailColumns = [
        { key: "county", label: "COUNTY", render: (u) => u.county ?? "" },
        { key: "zip", label: "ZIP", render: (u) => u.zip ?? "" },
        { key: "state", label: "STATE", render: (u) => u.state ?? "" },
        { key: "phone", label: "PHONE", render: (u) => u.phone ?? "" },
        { key: "medicaid", label: "MEDICAID", render: (u) => (u.medicaid ? "Yes" : "No") },
        { key: "paused", label: "paused", render: (u) => (u.paused ? "Yes" : "No") },
        { key: "complex", label: "complex", render: (u) => (u.complex ? "Yes" : "No") },
        {
            key: "schedule",
            label: "SCHEDULE",
            render: (u) =>
                u.schedule
                    ? ["M", "T", "W", "Th", "F", "Sa", "Su"]
                        .filter((_, i) => {
                            const k = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
                            return u.schedule[k[i]];
                        })
                        .join(" ")
                    : "",
        },
        {
            key: "geo",
            label: `GEO (${geoCount})`,
            render: (u) => ((u.lat ?? u.latitude) != null && (u.lng ?? u.longitude) != null ? "✓" : "—"),
        },
    ];

    const visibleColumns = showDetails ? [...baseColumns, ...detailColumns] : baseColumns;

    // === NEW: local sorting for the SIGN column ===
    const renderedUsers = React.useMemo(() => {
        if (!Array.isArray(users)) return [];
        if (sortKey !== "signatures") return users;

        const getCount = (u) => Number(sigCount[u.id] ?? 0);
        const cmp = (a, b) => {
            const ca = getCount(a);
            const cb = getCount(b);
            // 1) Has any signatures first
            const aHas = ca > 0 ? 1 : 0;
            const bHas = cb > 0 ? 1 : 0;
            if (aHas !== bHas) return bHas - aHas; // true (1) before false (0)
            // 2) Then by count (desc)
            if (ca !== cb) return cb - ca;
            // 3) Then by last, then first (asc) for stable UX
            const lastCmp = String(a.last ?? "").localeCompare(String(b.last ?? ""), undefined, { sensitivity: "base" });
            if (lastCmp) return lastCmp;
            return String(a.first ?? "").localeCompare(String(b.first ?? ""), undefined, { sensitivity: "base" });
        };

        const arr = [...users].sort(cmp);
        return sortAsc ? arr.reverse() : arr; // because cmp is desc on counts by default
    }, [users, sigCount, sortKey, sortAsc]);

    return (
        <table
            border="1"
            cellPadding="6"
            style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto", margin: 0 }}
        >
            <thead>
            <tr>
                <th style={{ width: 50, margin: 0 }}>#</th>
                {visibleColumns.map((c) => (
                    <th
                        key={c.key}
                        onClick={() => onSort && onSort(c.key)}
                        style={{ cursor: onSort ? "pointer" : "default", verticalAlign: "top", margin: 0 }}
                        title={onSort ? "Click to sort" : undefined}
                    >
                        {c.label}
                        {sortKey === c.key ? (sortAsc ? " ▲" : " ▼") : ""}
                    </th>
                ))}
                <th style={{ width: 180, margin: 0 }}>ACTIONS</th>
            </tr>
            </thead>
            <tbody>
            {(sortKey === "signatures" ? renderedUsers : users).map((u, i) => (
                <tr key={u.id} style={{ verticalAlign: "top", margin: 0 }}>
                    <td style={{ margin: 0 }}>{i + 1}</td>
                    {visibleColumns.map((c) => (
                        <td key={c.key} style={{ verticalAlign: "top", margin: 0 }}>
                            {c.render(u)}
                        </td>
                    ))}
                    <td style={{ whiteSpace: "nowrap", verticalAlign: "top", margin: 0 }}>
                        <Button size="small" onClick={() => onEdit?.(u)} disabled={!onEdit}>
                            Edit
                        </Button>
                        <Button
                            size="small"
                            color="error"
                            onClick={() => onDelete?.(u.id)}
                            disabled={!onDelete}
                            style={{ marginLeft: 6 }}
                        >
                            Delete
                        </Button>
                    </td>
                </tr>
            ))}
            </tbody>
        </table>
    );
}