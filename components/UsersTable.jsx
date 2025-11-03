// components/UsersTable.jsx
"use client";

import React from "react";
import {
    Box,
    Button,
    CircularProgress,
    IconButton,
    Tooltip,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DoneIcon from "@mui/icons-material/Done";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import CloseFullscreenIcon from "@mui/icons-material/CloseFullscreen";

export default function UsersTable({
                                       users = [],
                                       search = "",
                                       getCityColor = () => null,
                                       onVisibleCountChange = () => {},
                                       onVisibleRowsChange = () => {},
                                       onEdit,
                                       onDelete,
                                   }) {
    // UI state
    const [sortKey, setSortKey] = React.useState(null);
    const [sortAsc, setSortAsc] = React.useState(true);
    const [expanded, setExpanded] = React.useState(false);

    // signatures
    const [sigCount, setSigCount] = React.useState({});
    const [tokenPatch, setTokenPatch] = React.useState({});
    const [copiedUsers, setCopiedUsers] = React.useState({});
    const [loadingUsers, setLoadingUsers] = React.useState({});

    // ===== Helpers (normalizers) =====
    const getClientId = (u) =>
        u?.clientId ?? u?.client_id ?? u?.ClientId ?? u?.clientID ?? null;
    const getCaseId = (u) =>
        u?.caseId ?? u?.case_id ?? u?.CaseId ?? u?.caseID ?? null;

    const stringifyBillings = (b) => {
        try {
            return typeof b === "string" ? b : JSON.stringify(b ?? []);
        } catch {
            return String(b ?? "");
        }
    };

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch("/api/signatures/status", { cache: "no-store" });
                if (!res.ok) return;
                const rows = await res.json();
                if (cancelled) return;
                const map = {};
                for (const r of rows) map[r.userId] = r._count?.userId ?? r.collected ?? 0;
                setSigCount(map);
            } catch {}
        })();
        return () => { cancelled = true; };
    }, []);

    // filter
    const filtered = React.useMemo(() => {
        const q = (search || "").trim().toLowerCase();
        if (!q) return Array.isArray(users) ? users : [];
        const src = Array.isArray(users) ? users : [];
        return src.filter((u) => {
            let hay = [
                u.first, u.last, u.address, u.apt, u.city, u.county, u.zip, u.state,
                u.phone, u.dislikes, u.medicaid ? "yes" : "no",
                // NEW: include booleans and IDs in search
                u.bill ? "yes" : "no",
                u.delivery ? "yes" : "no",
                getClientId(u), getCaseId(u),
            ]
                .map((v) => (v == null ? "" : String(v)))
                .join(" ")
                .toLowerCase();

            hay += " " + stringifyBillings(u.billings);

            if (u?.schedule) {
                const k = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
                hay +=
                    " " + ["m","t","w","th","f","sa","su"].filter((_, i) => u.schedule[k[i]]).join(" ");
            }
            return hay.includes(q);
        });
    }, [users, search]);

    React.useEffect(() => {
        onVisibleCountChange(filtered.length);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filtered.length]);

    // sort helpers
    const getSigCount = (u) => Number(sigCount[u.id] ?? 0);
    const getDate = (v) => (v ? new Date(v).getTime() : 0);
    const billingsLen = (b) => {
        if (Array.isArray(b)) return b.length;
        try {
            if (typeof b === "string") return b.length;
            return JSON.stringify(b ?? "").length;
        } catch {
            return 0;
        }
    };

    // sort
    const sorted = React.useMemo(() => {
        if (!sortKey) return filtered;

        if (sortKey === "signatures") {
            const arr = [...filtered].sort((a, b) => {
                const ca = getSigCount(a), cb = getSigCount(b);
                const aHas = ca > 0 ? 1 : 0, bHas = cb > 0 ? 1 : 0;
                if (aHas !== bHas) return bHas - aHas;
                if (ca !== cb) return cb - ca;
                const lastCmp = String(a.last ?? "").localeCompare(String(b.last ?? ""), undefined, { sensitivity: "base" });
                if (lastCmp) return lastCmp;
                return String(a.first ?? "").localeCompare(String(b.first ?? ""), undefined, { sensitivity: "base" });
            });
            return sortAsc ? arr.reverse() : arr;
        }

        if (sortKey === "createdAt") {
            const arr = [...filtered].sort((a, b) => {
                const av = getDate(a.createdAt);
                const bv = getDate(b.createdAt);
                return sortAsc ? av - bv : bv - av;
            });
            return arr;
        }

        if (sortKey === "billings") {
            const arr = [...filtered].sort((a, b) => {
                const av = billingsLen(a.billings);
                const bv = billingsLen(b.billings);
                if (av !== bv) return sortAsc ? av - bv : bv - av;
                const lastCmp = String(a.last ?? "").localeCompare(String(b.last ?? ""), undefined, { sensitivity: "base" });
                if (lastCmp) return lastCmp;
                return String(a.first ?? "").localeCompare(String(b.first ?? ""), undefined, { sensitivity: "base" });
            });
            return arr;
        }

        // default string-ish compare (booleans stringify fine)
        const arr = [...filtered].sort((a, b) => {
            const av = (a?.[sortKey] ?? "").toString().toLowerCase();
            const bv = (b?.[sortKey] ?? "").toString().toLowerCase();
            if (av < bv) return sortAsc ? -1 : 1;
            if (av > bv) return sortAsc ? 1 : -1;
            return 0;
        });
        return arr;
    }, [filtered, sortKey, sortAsc, sigCount]);

    // provide current rows to page (for exports)
    React.useEffect(() => {
        onVisibleRowsChange(sorted);
    }, [sorted, onVisibleRowsChange]);

    // =========================
    // Columns (with row number)
    // =========================
    const indexCol = { key: "__rownum", label: "#", sort: [] };

    // Base (always visible): includes Billings column
    const baseCols = [
        { key: "name", label: "Name", sort: ["first", "last"] },
        { key: "sign", label: "SIGN", sort: ["signatures"] },
        { key: "address", label: "Address", sort: ["address"] },
        { key: "apt", label: "Apt", sort: ["apt"] },
        { key: "city", label: "City", sort: ["city"] },
        { key: "dislikes", label: "Dislikes", sort: ["dislikes"] },
        { key: "billings", label: "Billings", sort: ["billings"] }, // visible
        { key: "actions", label: "", sort: [] },
    ];

    // Detail shelf (hidden until expanded): includes Bill + Delivery + IDs + meta
    const detailCols = [
        { key: "complex", label: "Complex", sort: ["complex"] },
        { key: "paused", label: "Paused", sort: ["paused"] },
        { key: "medicaid", label: "Medicaid", sort: ["medicaid"] },

        // NEW booleans
        { key: "bill", label: "Bill", sort: ["bill"] },
        { key: "delivery", label: "Delivery", sort: ["delivery"] },

        { key: "county", label: "County", sort: ["county"] },
        { key: "zip", label: "Zip", sort: ["zip"] },
        { key: "state", label: "State", sort: ["state"] },
        { key: "phone", label: "Phone", sort: ["phone"] },
        { key: "schedule", label: "Schedule", sort: ["schedule"] },
        { key: "geo", label: "Geo", sort: ["geo"] },
        { key: "createdAt", label: "Created", sort: ["createdAt"] },

        // hidden IDs with links
        { key: "clientId", label: "Client ID", sort: ["clientId"] },
        { key: "caseId", label: "Case ID", sort: ["caseId"] },
    ];

    const columns = expanded ? [indexCol, ...baseCols, ...detailCols] : [indexCol, ...baseCols];
    const baseCount = 1 + baseCols.length;

    const SortGlyph = ({ active }) =>
        active ? (sortAsc ? <ArrowUpwardIcon fontSize="inherit" /> : <ArrowDownwardIcon fontSize="inherit" />)
            : (<UnfoldMoreIcon fontSize="inherit" />);

    const setSort = (k) => {
        setSortAsc((prev) => (k === sortKey ? !prev : true));
        setSortKey(k);
    };
    // Robustly parse billings to an array
    const parseBillingsArray = (b) => {
        if (Array.isArray(b)) return b;
        try {
            if (typeof b === "string") return JSON.parse(b);
        } catch {}
        return [];
    };

// Pick the latest billing by addedAt, meta.when, then end
    const getLatestBilling = (b) => {
        const arr = parseBillingsArray(b);
        if (!arr.length) return null;
        return arr.slice().sort((a, b) => {
            const ta = new Date(a?.addedAt ?? a?.meta?.when ?? a?.end ?? 0).getTime() || 0;
            const tb = new Date(b?.addedAt ?? b?.meta?.when ?? b?.end ?? 0).getTime() || 0;
            return tb - ta; // newest first
        })[0];
    };

// MM/DD/YYYY
    const fmtMDY = (iso) => {
        if (!iso) return null;
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return null;
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        const yyyy = d.getFullYear();
        return `${mm}/${dd}/${yyyy}`;
    };

// Render "MM/DD/YYYY-MM/DD/YYYY" (or "—" if none)
    const renderLatestBillingRange = (b) => {
        const latest = getLatestBilling(b);
        if (!latest) return "—";
        const s = fmtMDY(latest.start);
        const e = fmtMDY(latest.end);
        if (s && e) return `${s}-${e}`;
        return s || e || "—";
    };


    const wrap = { whiteSpace: "normal", wordBreak: "normal", overflowWrap: "break-word" };
    const mono = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace" };

    const fmtCreated = (v) => {
        if (!v) return "—";
        try {
            const d = new Date(v);
            return d.toLocaleString();
        } catch {
            return String(v);
        }
    };

    // Build Unite Us URL when both IDs exist (clientId first in path after caseId)
    const uniteUsHref = (u) => {
        const cid = getClientId(u);
        const kid = getCaseId(u);
        if (!cid || !kid) return null;
        return `https://app.uniteus.io/dashboard/cases/open/${encodeURIComponent(kid)}/contact/${encodeURIComponent(cid)}`;
    };

    const SignCell = (u) => {
        const collected = sigCount[u.id] ?? 0;
        const done = collected >= 5;
        const isCopied = copiedUsers[u.id] || false;
        const isLoading = loadingUsers[u.id] || false;

        const ensureToken = async () => {
            try {
                const legacy = await fetch(`/api/signatures/ensure-token/${u.id}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: "{}",
                });
                if (legacy.ok) return (await legacy.json()).sign_token ?? null;
                const body = await fetch(`/api/signatures/ensure-token`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ userId: u.id }),
                });
                const data = await body.json();
                return data.sign_token ?? data.signToken ?? data.token ?? null;
            } catch {
                return null;
            }
        };

        const onClick = async () => {
            if (isLoading) return;
            setLoadingUsers((p) => ({ ...p, [u.id]: true }));
            const token =
                tokenPatch[u.id] ??
                u.signToken ??
                u.sign_token ??
                u.token ??
                (await ensureToken());
            setLoadingUsers((p) => ({ ...p, [u.id]: false }));
            if (!token) return alert("Could not create a signature link. Try again.");

            const base = `${window.location.origin}/sign/${token}`;
            if (done) {
                const viewerUrl = `${base}/view`;
                try {
                    const head = await fetch(viewerUrl, { method: "HEAD" });
                    window.open(head.ok ? viewerUrl : base, "_blank", "noopener,noreferrer");
                } catch {
                    window.open(base, "_blank", "noopener,noreferrer");
                }
            } else {
                try {
                    await navigator.clipboard.writeText(base);
                    setCopiedUsers((p) => ({ ...p, [u.id]: true }));
                    setTimeout(() => setCopiedUsers((p) => ({ ...p, [u.id]: false })), 1800);
                } catch {
                    alert("Failed to copy link.");
                }
            }
        };

        return (
            <Tooltip title={done ? "View completed signatures" : isCopied ? "Link Copied!" : "Copy link"}>
                <IconButton size="small" onClick={onClick} aria-label="Sign link" disabled={isLoading}>
                    {isLoading ? (
                        <CircularProgress size={18} color="primary" />
                    ) : done || isCopied ? (
                        <DoneIcon sx={{ color: "#4caf50" }} fontSize="small" />
                    ) : (
                        <ContentCopyIcon sx={{ color: "#1976d2" }} fontSize="small" />
                    )}
                </IconButton>
            </Tooltip>
        );
    };

    /* =========================
       RENDER
       ========================= */
    return (
        <Box sx={{ width: "100%", height: "100%", overflow: "auto" }}>
            <Box sx={{ minWidth: "100%" }}>
                <table
                    style={{
                        tableLayout: "auto",
                        width: "auto",
                        minWidth: "1200px",
                        borderCollapse: "separate",
                        borderSpacing: "12px 8px",
                    }}
                >
                    <thead>
                    <tr style={{ position: "sticky", top: 0, zIndex: 6 }}>
                        {columns.map((col, i) => {
                            const isShelfStart = expanded && i === baseCount;
                            const k = col.sort?.[0];
                            const isIndex = col.key === "__rownum";
                            return (
                                <th
                                    key={col.key}
                                    onClick={k ? () => setSort(k) : undefined}
                                    title={k ? "Click to sort" : undefined}
                                    style={{
                                        position: "sticky",
                                        top: 0,
                                        background: "rgba(255,255,255,0.94)",
                                        backdropFilter: "saturate(180%) blur(6px)",
                                        border: "1px solid rgba(0,0,0,0.08)",
                                        padding: "10px 12px",
                                        fontWeight: 800,
                                        whiteSpace: "nowrap",
                                        cursor: k ? "pointer" : "default",
                                        verticalAlign: "bottom",
                                        boxShadow: "0 8px 14px rgba(0,0,0,0.06)",
                                        ...(isShelfStart ? { boxShadow: "inset 3px 0 0 #d8dee6" } : null),
                                        ...(isIndex ? { width: 52, minWidth: 52, textAlign: "right" } : null),
                                    }}
                                >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {isIndex ? "#" : col.key === "actions" ? (
                          <Tooltip title={expanded ? "Collapse details" : "Expand details"}>
                              <IconButton
                                  size="small"
                                  onClick={(e) => {
                                      e.stopPropagation();
                                      setExpanded((v) => !v);
                                  }}
                              >
                                  {expanded ? <CloseFullscreenIcon /> : <OpenInFullIcon />}
                              </IconButton>
                          </Tooltip>
                      ) : (
                          <>
                              {col.label}
                              {col.key === "name" && (
                                  <>
                                      <IconButton
                                          size="small"
                                          onClick={(e) => { e.stopPropagation(); setSort("first"); }}
                                          sx={{ p: 0.25 }}
                                      >
                                          {sortKey === "first" ? (sortAsc ? <ArrowUpwardIcon fontSize="inherit" /> : <ArrowDownwardIcon fontSize="inherit" />) : <UnfoldMoreIcon fontSize="inherit" />}
                                          <span style={{ fontSize: 11, marginLeft: 2 }}>F</span>
                                      </IconButton>
                                      <IconButton
                                          size="small"
                                          onClick={(e) => { e.stopPropagation(); setSort("last"); }}
                                          sx={{ p: 0.25 }}
                                      >
                                          {sortKey === "last" ? (sortAsc ? <ArrowUpwardIcon fontSize="inherit" /> : <ArrowDownwardIcon fontSize="inherit" />) : <UnfoldMoreIcon fontSize="inherit" />}
                                          <span style={{ fontSize: 11, marginLeft: 2 }}>L</span>
                                      </IconButton>
                                  </>
                              )}
                              {k && col.key !== "name" && (
                                  <IconButton
                                      size="small"
                                      onClick={(e) => { e.stopPropagation(); setSort(k); }}
                                      sx={{ p: 0.25 }}
                                  >
                                      {sortKey === k ? (sortAsc ? <ArrowUpwardIcon fontSize="inherit" /> : <ArrowDownwardIcon fontSize="inherit" />) : <UnfoldMoreIcon fontSize="inherit" />}
                                  </IconButton>
                              )}
                          </>
                      )}
                    </span>
                                </th>
                            );
                        })}
                    </tr>
                    </thead>

                    <tbody>
                    {sorted.map((u, idx) => {
                        const cityColor = getCityColor(u.city) || undefined;

                        const cells = {
                            __rownum: (
                                <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", opacity: 0.85, fontWeight: 700 }}>
                                    {idx + 1}
                                </div>
                            ),
                            name: (
                                <div style={{ ...wrap, fontWeight: 800 }}>
                                    {(u.first ?? "") + (u.last ? ` ${u.last}` : "")}
                                </div>
                            ),
                            sign: <div>{SignCell(u)}</div>,
                            address: <div style={wrap}>{u.address ?? ""}</div>,
                            apt: <div style={wrap}>{u.apt ?? ""}</div>,
                            city: (
                                <div style={{ ...wrap, color: cityColor || "inherit", fontWeight: 700 }}>
                                    {u.city ?? ""}
                                </div>
                            ),
                            dislikes: <div style={{ ...wrap, whiteSpace: "pre-wrap" }}>{u.dislikes ?? ""}</div>,

                            billings: (
                                <div style={{ ...wrap, ...mono }} title={stringifyBillings(u.billings)}>
                                    {renderLatestBillingRange(u.billings)}
                                </div>
                            ),

                            actions: (
                                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                                    <Button type="button" size="small" onClick={() => onEdit?.(u)} disabled={!onEdit}>
                                        Edit
                                    </Button>
                                    <Button
                                        type="button"
                                        size="small"
                                        color="error"
                                        onClick={() => onDelete?.(u.id)}
                                        disabled={!onDelete}
                                    >
                                        Delete
                                    </Button>
                                </div>
                            ),
                            complex: <div style={wrap}>{u.complex ? "Yes" : "No"}</div>,
                            paused: <div style={wrap}>{u.paused ? "Yes" : "No"}</div>,
                            medicaid: <div style={wrap}>{u.medicaid ? "Yes" : "No"}</div>,
                            bill: <div style={wrap}>{u.bill ? "Yes" : "No"}</div>,
                            delivery: <div style={wrap}>{u.delivery ? "Yes" : "No"}</div>,
                            county: <div style={wrap}>{u.county ?? ""}</div>,
                            zip: <div style={wrap}>{u.zip ?? ""}</div>,
                            state: <div style={wrap}>{u.state ?? ""}</div>,
                            phone: <div style={wrap}>{u.phone ?? ""}</div>,
                            schedule: (
                                <div style={wrap}>
                                    {u.schedule
                                        ? ["M","T","W","Th","F","Sa","Su"]
                                            .filter((_, i) => {
                                                const k = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
                                                return u.schedule[k[i]];
                                            })
                                            .join(" ")
                                        : "—"}
                                </div>
                            ),
                            geo: (
                                <div style={wrap}>
                                    {(u.lat ?? u.latitude) != null && (u.lng ?? u.longitude) != null ? "✓" : "—"}
                                </div>
                            ),
                            createdAt: <div style={{ ...wrap, opacity: 0.8 }}>{fmtCreated(u.createdAt)}</div>,
                            caseId: (() => {
                                const caseId = getCaseId(u);
                                if (!caseId) return <div style={{ ...wrap, ...mono }}>—</div>;
                                const href = uniteUsHref(u);
                                return (
                                    <div style={{ ...wrap, ...mono }}>
                                        {href ? (
                                            <a
                                                href={href}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={{ textDecoration: "underline", color: "#1976d2" }}
                                                title="Open in Unite Us"
                                            >
                                                {caseId}
                                            </a>
                                        ) : (
                                            caseId
                                        )}
                                    </div>
                                );
                            })(),
                            clientId: (() => {
                                const clientId = getClientId(u);
                                if (!clientId) return <div style={{ ...wrap, ...mono }}>—</div>;
                                const href = uniteUsHref(u);
                                return (
                                    <div style={{ ...wrap, ...mono }}>
                                        {href ? (
                                            <a
                                                href={href}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={{ textDecoration: "underline", color: "#1976d2" }}
                                                title="Open in Unite Us"
                                            >
                                                {clientId}
                                            </a>
                                        ) : (
                                            clientId
                                        )}
                                    </div>
                                );
                            })(),
                        };

                        return (
                            <tr key={u.id}>
                                {columns.map((c, i) => {
                                    const isShelfStart = expanded && i === baseCount;
                                    const isIndex = c.key === "__rownum";
                                    return (
                                        <td
                                            key={`${u.id}-${c.key}`}
                                            style={{
                                                background:
                                                    isShelfStart || (expanded && i > baseCount)
                                                        ? "linear-gradient(#fafafa,#fafafa)"
                                                        : "#fff",
                                                boxShadow: "0 1px 0 rgba(0,0,0,0.06) inset",
                                                border: "1px solid rgba(0,0,0,0.06)",
                                                padding: "10px 12px",
                                                verticalAlign: "top",
                                                minWidth: isIndex ? 52 : 120,
                                                ...(isShelfStart ? { boxShadow: "inset 3px 0 0 #d8dee6" } : null),
                                                ...(isIndex ? { textAlign: "right", fontVariantNumeric: "tabular-nums" } : null),
                                            }}
                                        >
                                            {cells[c.key]}
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}
                    </tbody>
                </table>
            </Box>
        </Box>
    );
}