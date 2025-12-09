// fix-missing-stops.js
// Script to find and fix users who have delivery=true, paused=false but no stops

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('=== Finding users with delivery=true, paused=false but no stops ===\n');

    // Find all users who should have stops but don't
    const users = await prisma.user.findMany({
        where: {
            paused: false,
            delivery: true,
        },
        select: {
            id: true,
            first: true,
            last: true,
            address: true,
            apt: true,
            city: true,
            state: true,
            zip: true,
            phone: true,
            lat: true,
            lng: true,
            paused: true,
            delivery: true,
        },
        orderBy: { id: 'asc' },
    });

    console.log(`Total users with delivery=true and paused=false: ${users.length}\n`);

    // Check which ones have stops
    const usersWithoutStops = [];
    
    for (const user of users) {
        const stopCount = await prisma.stop.count({
            where: { userId: user.id }
        });
        
        if (stopCount === 0) {
            usersWithoutStops.push(user);
        }
    }

    console.log(`Users WITHOUT any stops: ${usersWithoutStops.length}\n`);

    if (usersWithoutStops.length === 0) {
        console.log('✅ All active users have stops. No action needed.');
        return;
    }

    console.log('Users missing stops:');
    console.log('-------------------');
    usersWithoutStops.forEach(u => {
        console.log(`ID: ${u.id} | Name: ${u.first} ${u.last} | City: ${u.city} | Coords: ${u.lat}, ${u.lng}`);
    });
    console.log('\n');

    // Ask for confirmation (in a real scenario, you might want to use readline)
    console.log('⚠️  This script will create stops for the above users.');
    console.log('💡 To proceed, uncomment the creation logic below and run again.\n');

    // UNCOMMENT THE SECTION BELOW TO ACTUALLY CREATE THE STOPS
    /*
    console.log('Creating stops...\n');
    
    let created = 0;
    for (const user of usersWithoutStops) {
        try {
            await prisma.stop.create({
                data: {
                    day: 'all',
                    userId: user.id,
                    name: `${user.first || ''} ${user.last || ''}`.trim() || '(Unnamed)',
                    address: user.address || '',
                    apt: user.apt,
                    city: user.city || '',
                    state: user.state || '',
                    zip: user.zip || '',
                    phone: user.phone,
                    lat: user.lat,
                    lng: user.lng,
                }
            });
            console.log(`✅ Created stop for ${user.first} ${user.last} (ID: ${user.id})`);
            created++;
        } catch (error) {
            console.error(`❌ Failed to create stop for ${user.first} ${user.last} (ID: ${user.id}):`, error.message);
        }
    }
    
    console.log(`\n✅ Successfully created ${created} stops out of ${usersWithoutStops.length} users.`);
    */
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
