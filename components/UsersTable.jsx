// components/UsersTable.jsx
import React from "react";
import { Button, IconButton, Tooltip } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import LinkIcon from "@mui/icons-material/Link";

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
    // signature counts (userId -> number)
    const [sigCount, setSigCount] = React.useState({});
    // cache of tokens we might fetch on-demand
    const [tokenPatch, setTokenPatch] = React.useState({}); // { [userId]: sign_token }

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch("/api/signatures/status", { cache: "no-store" });
                if (!res.ok) return;
                const rows = await res.json(); // [{ userId, collected }]
                if (cancelled) return;
                const map = {};
                for (const r of rows) map[r.userId] = r._count?.userId ?? r.collected ?? 0;
                setSigCount(map);
            } catch {}
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const getToken = async (u) => {
        const existing = tokenPatch[u.id] ?? u.sign_token;
        if (existing) return existing;
        try {
            const res = await fetch(`/api/signatures/ensure-token/${u.id}`, { method: "POST" });
            if (res.ok) {
                const { sign_token } = await res.json();
                setTokenPatch((m) => ({ ...m, [u.id]: sign_token }));
                return sign_token;
            }
        } catch {}
        return null;
    };

    const geoCount = Array.isArray(users)
        ? users.filter((u) => (u.lat ?? u.latitude) != null && (u.lng ?? u.longitude) != null).length
        : 0;

    // ---- Columns ----

    const signColumn = {
        key: "signatures",
        label: "SIGN",
        render: (u) => {
            const collected = sigCount[u.id] ?? 0;
            const done = collected >= 5;

            const handleClick = async () => {
                const token = await getToken(u);
                if (!token) {
                    alert("Could not create a signature link for this user.");
                    return;
                }
                if (done) {
                    // open read-only viewer
                    window.open(`/sign/${token}/view`, "_blank", "noopener,noreferrer");
                } else {
                    // copy public link
                    const link = `${window.location.origin}/sign/${token}`;
                    await navigator.clipboard.writeText(link);
                    // alert("Signature link copied to clipboard!");
                }
            };

            return (
                <Tooltip title={done ? "View completed signatures" : "Copy public signature link"}>
                    <IconButton
                        size="small"
                        onClick={handleClick}
                        aria-label={done ? "Open signatures" : "Copy signature link"}
                    >
                        {done ? <CheckCircleIcon style={{ color: "#4caf50" }} /> : <LinkIcon style={{ color: "#1976d2" }} />}
                    </IconButton>
                </Tooltip>
            );
        },
    };

    // base columns (always visible) — SIGN goes right after LAST
    const baseColumns = [
        { key: "first", label: "FIRST", render: (u) => u.first ?? "" },
        { key: "last", label: "LAST", render: (u) => u.last ?? "" },
        signColumn, // <-- always shown, right after LAST
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

    // detail columns (only when showDetails = true) — PROOF removed
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

    return (
        <table
            border="1"
            cellPadding="6"
            style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto" }}
        >
            <thead>
            <tr>
                <th style={{ width: 50 }}>#</th>
                {visibleColumns.map((c) => (
                    <th
                        key={c.key}
                        onClick={() => onSort && onSort(c.key)}
                        style={{ cursor: onSort ? "pointer" : "default", verticalAlign: "top" }}
                        title={onSort ? "Click to sort" : undefined}
                    >
                        {c.label}
                        {sortKey === c.key ? (sortAsc ? " ▲" : " ▼") : ""}
                    </th>
                ))}
                <th style={{ width: 180 }}>ACTIONS</th>
            </tr>
            </thead>
            <tbody>
            {users.map((u, i) => (
                <tr key={u.id} style={{ verticalAlign: "top" }}>
                    <td>{i + 1}</td>
                    {visibleColumns.map((c) => (
                        <td key={c.key} style={{ verticalAlign: "top" }}>
                            {c.render(u)}
                        </td>
                    ))}
                    <td style={{ whiteSpace: "nowrap", verticalAlign: "top" }}>
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