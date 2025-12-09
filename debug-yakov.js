// Debug script to check YAKOV LAMm user and stops
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('=== Searching for YAKOV LAMm ===\n');

    // Search for user with similar name
    const users = await prisma.user.findMany({
        where: {
            OR: [
                { first: { contains: 'YAKOV', mode: 'insensitive' } },
                { last: { contains: 'LAM', mode: 'insensitive' } },
            ]
        },
        select: {
            id: true,
            first: true,
            last: true,
            address: true,
            city: true,
            phone: true,
            paused: true,
            delivery: true,
            bill: true,
            lat: true,
            lng: true,
        }
    });

    console.log(`Found ${users.length} matching user(s):\n`);
    users.forEach(u => {
        console.log(`User ID: ${u.id}`);
        console.log(`Name: ${u.first} ${u.last}`);
        console.log(`Address: ${u.address}, ${u.city}`);
        console.log(`Phone: ${u.phone}`);
        console.log(`Paused: ${u.paused}`);
        console.log(`Delivery: ${u.delivery}`);
        console.log(`Bill: ${u.bill}`);
        console.log(`Coordinates: ${u.lat}, ${u.lng}`);
        console.log('---\n');
    });

    if (users.length === 0) {
        console.log('No users found matching YAKOV LAM');
        return;
    }

    // Check stops for each user
    for (const user of users) {
        console.log(`\n=== Checking stops for User ID ${user.id} (${user.first} ${user.last}) ===\n`);

        const stops = await prisma.stop.findMany({
            where: { userId: user.id },
            select: {
                id: true,
                day: true,
                name: true,
                address: true,
                city: true,
                assignedDriverId: true,
                order: true,
                lat: true,
                lng: true,
            }
        });

        console.log(`Found ${stops.length} stop(s) for this user:\n`);
        stops.forEach(s => {
            console.log(`Stop ID: ${s.id}`);
            console.log(`Day: ${s.day}`);
            console.log(`Name: ${s.name}`);
            console.log(`Address: ${s.address}, ${s.city}`);
            console.log(`Assigned Driver ID: ${s.assignedDriverId || 'Unassigned'}`);
            console.log(`Order: ${s.order || 'No order'}`);
            console.log(`Coordinates: ${s.lat}, ${s.lng}`);
            console.log('---\n');
        });

        // Check if user meets criteria for being in stops list
        console.log('\n=== Analysis ===');
        console.log(`Should appear in stops list: ${!user.paused && user.delivery !== false ? 'YES' : 'NO'}`);

        if (user.paused) {
            console.log('❌ User is PAUSED - this will exclude them from stops');
        }
        if (user.delivery === false) {
            console.log('❌ User has Delivery = false - this will exclude them from stops');
        }
        if (user.bill === false) {
            console.log('⚠️  User has Bill = false (but this doesn\'t exclude from stops)');
        }
        if (!user.lat || !user.lng) {
            console.log('⚠️  User has no coordinates - will show as ungeocoded');
        }
        if (!user.paused && user.delivery !== false) {
            console.log('✅ User should appear in stops list');
            if (stops.length === 0) {
                console.log('⚠️  BUT NO STOPS FOUND - Need to run route generation to create stops');
            }
        }
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
