-- SQL queries to investigate YAKOV LAMM customer issue
-- This customer appears on the main customer page but has no stop (not even unrouted)
-- Customer is not paused and delivery is enabled

-- 1. Find the YAKOV LAMM user record
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
    paused,
    delivery,
    bill,
    lat,
    lng,
    "clientId",
    "caseId",
    "createdAt",
    "updatedAt"
FROM "User"
WHERE 
    UPPER(first) LIKE '%YAKOV%' 
    AND UPPER(last) LIKE '%LAMM%';

-- 2. Check if there are any stops associated with this user
-- (Replace USER_ID with the actual ID from query 1)
SELECT 
    s.id,
    s.day,
    s."userId",
    s.name,
    s.address,
    s.city,
    s.state,
    s.zip,
    s.order,
    s."assignedDriverId",
    s.completed,
    s.lat,
    s.lng,
    s."createdAt",
    s."updatedAt"
FROM "Stop" s
WHERE s."userId" IN (
    SELECT id FROM "User" 
    WHERE UPPER(first) LIKE '%YAKOV%' 
    AND UPPER(last) LIKE '%LAMM%'
);

-- 3. Check the user's schedule (delivery days)
SELECT 
    sch.id,
    sch."userId",
    sch.monday,
    sch.tuesday,
    sch.wednesday,
    sch.thursday,
    sch.friday,
    sch.saturday,
    sch.sunday,
    u.first,
    u.last
FROM "Schedule" sch
JOIN "User" u ON sch."userId" = u.id
WHERE u.id IN (
    SELECT id FROM "User" 
    WHERE UPPER(first) LIKE '%YAKOV%' 
    AND UPPER(last) LIKE '%LAMM%'
);

-- 4. Check all users with delivery=true and paused=false but NO stops
-- This will show if YAKOV LAMM is part of a larger issue
SELECT 
    u.id,
    u.first,
    u.last,
    u.address,
    u.city,
    u.paused,
    u.delivery,
    u.lat,
    u.lng,
    COUNT(s.id) as stop_count
FROM "User" u
LEFT JOIN "Stop" s ON s."userId" = u.id
WHERE 
    u.paused = false 
    AND u.delivery = true
GROUP BY u.id, u.first, u.last, u.address, u.city, u.paused, u.delivery, u.lat, u.lng
HAVING COUNT(s.id) = 0
ORDER BY u.last, u.first;

-- 5. Check if there are any orphaned stops (stops with no matching user)
SELECT 
    s.id,
    s.day,
    s."userId",
    s.name,
    s.address,
    s.city
FROM "Stop" s
LEFT JOIN "User" u ON s."userId" = u.id
WHERE u.id IS NULL;

-- 6. Summary statistics
SELECT 
    'Total Users' as metric,
    COUNT(*) as count
FROM "User"
UNION ALL
SELECT 
    'Users with delivery=true and paused=false' as metric,
    COUNT(*) as count
FROM "User"
WHERE delivery = true AND paused = false
UNION ALL
SELECT 
    'Total Stops' as metric,
    COUNT(*) as count
FROM "Stop"
UNION ALL
SELECT 
    'Users with delivery=true, paused=false, but NO stops' as metric,
    COUNT(DISTINCT u.id) as count
FROM "User" u
LEFT JOIN "Stop" s ON s."userId" = u.id
WHERE u.delivery = true AND u.paused = false AND s.id IS NULL;

-- 7. Check if coordinates are missing (geocoding issue)
SELECT 
    id,
    first,
    last,
    address,
    city,
    lat,
    lng,
    "geocodedAt",
    paused,
    delivery
FROM "User"
WHERE 
    UPPER(first) LIKE '%YAKOV%' 
    AND UPPER(last) LIKE '%LAMM%';
