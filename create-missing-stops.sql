-- Manual fix: Create stops for YAKOV LAMM and YIDIS STEINER
-- Run this SQL directly to create the missing stops

-- First, verify the users exist and get their details
SELECT 
    id,
    first,
    last,
    address,
    apt,
    city,
    state,
    zip,
    phone,
    lat,
    lng,
    paused,
    delivery
FROM "User"
WHERE 
    (UPPER(first) LIKE '%YAKOV%' AND UPPER(last) LIKE '%LAMM%')
    OR id = 247;

-- Create stop for YAKOV LAMM (replace USER_ID with actual ID from above query)
INSERT INTO "Stop" (
    day,
    "userId",
    name,
    address,
    apt,
    city,
    state,
    zip,
    phone,
    lat,
    lng,
    completed,
    "assignedDriverId",
    "order",
    "createdAt",
    "updatedAt"
)
SELECT 
    'all' as day,
    id as "userId",
    CONCAT(first, ' ', last) as name,
    address,
    apt,
    city,
    state,
    zip,
    phone,
    lat,
    lng,
    false as completed,
    NULL as "assignedDriverId",
    NULL as "order",
    NOW() as "createdAt",
    NOW() as "updatedAt"
FROM "User"
WHERE UPPER(first) LIKE '%YAKOV%' AND UPPER(last) LIKE '%LAMM%'
ON CONFLICT DO NOTHING;

-- Create stop for YIDIS STEINER (ID: 247)
INSERT INTO "Stop" (
    day,
    "userId",
    name,
    address,
    apt,
    city,
    state,
    zip,
    phone,
    lat,
    lng,
    completed,
    "assignedDriverId",
    "order",
    "createdAt",
    "updatedAt"
)
SELECT 
    'all' as day,
    id as "userId",
    CONCAT(first, ' ', last) as name,
    address,
    apt,
    city,
    state,
    zip,
    phone,
    lat,
    lng,
    false as completed,
    NULL as "assignedDriverId",
    NULL as "order",
    NOW() as "createdAt",
    NOW() as "updatedAt"
FROM "User"
WHERE id = 247
ON CONFLICT DO NOTHING;

-- Verify the stops were created
SELECT 
    s.id,
    s.day,
    s."userId",
    s.name,
    s.address,
    s.city,
    u.first,
    u.last,
    u.paused,
    u.delivery
FROM "Stop" s
JOIN "User" u ON s."userId" = u.id
WHERE 
    (UPPER(u.first) LIKE '%YAKOV%' AND UPPER(u.last) LIKE '%LAMM%')
    OR u.id = 247
ORDER BY s."userId";
