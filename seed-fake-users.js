// seed-fake-users.js
// Script to seed the database with 50 fake users

require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Sample data arrays
const firstNames = [
  'David', 'Sarah', 'Michael', 'Rachel', 'Jonathan', 'Esther', 'Daniel', 'Miriam',
  'Joshua', 'Chana', 'Benjamin', 'Rivka', 'Aaron', 'Leah', 'Joseph', 'Deborah',
  'Samuel', 'Hannah', 'Jacob', 'Ruth', 'Isaac', 'Naomi', 'Moshe', 'Tova',
  'Yitzchak', 'Shira', 'Yosef', 'Malka', 'Shmuel', 'Bracha', 'Yakov', 'Sara',
  'Avraham', 'Chaya', 'Yehuda', 'Dina', 'Reuven', 'Tzipora', 'Shimon', 'Yael',
  'Levi', 'Adina', 'Naftali', 'Elisheva', 'Gad', 'Penina', 'Asher', 'Tamar',
  'Dan', 'Shoshana'
];

const lastNames = [
  'Cohen', 'Levy', 'Weiss', 'Goldstein', 'Katz', 'Rosenberg', 'Friedman', 'Shapiro',
  'Silver', 'Greenberg', 'Stein', 'Roth', 'Gross', 'Klein', 'Berger', 'Muller',
  'Schwartz', 'Feldman', 'Goldman', 'Rosen', 'Stern', 'Adler', 'Baum', 'Blum',
  'Fischer', 'Hoffman', 'Kaufman', 'Lerner', 'Mendelsohn', 'Neumann', 'Oren',
  'Perlman', 'Rabinowitz', 'Segal', 'Tannenbaum', 'Wagner', 'Zimmerman', 'Abramson',
  'Feinstein', 'Geller', 'Hirsch', 'Jacobs', 'Kramer', 'Levin', 'Morris', 'Novak',
  'Parker', 'Richter', 'Singer', 'Weinberg'
];

const cities = [
  'Lakewood', 'Monsey', 'Brooklyn', 'Manhattan', 'Queens', 'Teaneck', 'Passaic',
  'Elizabeth', 'Newark', 'Jersey City', 'Paramus', 'Fair Lawn', 'Englewood',
  'Bergenfield', 'Monroe', 'Spring Valley', 'New Square', 'Kiryas Joel', 'Ramapo'
];

const streets = [
  'Main St', 'Park Ave', 'Oak St', 'Maple Dr', 'Cedar Ln', 'Elm St', 'Pine Rd',
  'Washington Ave', 'Lincoln Blvd', 'Madison St', 'Jefferson Dr', 'Roosevelt Ave',
  'Broadway', 'First St', 'Second St', 'Third Ave', 'Fourth St', 'Fifth Ave',
  'Highland Ave', 'Valley Rd', 'Hill St', 'Ridge Dr', 'Summit Ave', 'Grove St'
];

const states = ['NJ', 'NY', 'NY'];

function randomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomPhone() {
  return `(${randomInt(201, 973)}) ${randomInt(200, 999)}-${randomInt(1000, 9999)}`;
}

function randomZip() {
  return randomInt(10000, 99999).toString();
}

function randomLat() {
  // Rough bounds for NJ/NY area: 39.5 to 41.9
  return 39.5 + Math.random() * 2.4;
}

function randomLng() {
  // Rough bounds for NJ/NY area: -75.8 to -72.9
  return -75.8 + Math.random() * 2.9;
}

async function main() {
  console.log('🌱 Seeding database with 50 fake users...\n');

  const users = [];
  
  for (let i = 0; i < 50; i++) {
    const first = randomElement(firstNames);
    const last = randomElement(lastNames);
    const streetNum = randomInt(1, 9999);
    const street = randomElement(streets);
    const city = randomElement(cities);
    const state = randomElement(states);
    const zip = randomZip();
    const apt = Math.random() > 0.7 ? `Apt ${randomInt(1, 20)}` : null;
    
    const lat = randomLat();
    const lng = randomLng();
    
    users.push({
      first,
      last,
      address: `${streetNum} ${street}`,
      apt,
      city,
      state,
      zip,
      phone: randomPhone(),
      county: city === 'Lakewood' ? 'Ocean' : city === 'Monsey' ? 'Rockland' : null,
      medicaid: Math.random() > 0.7,
      paused: Math.random() > 0.9,
      complex: Math.random() > 0.85,
      bill: Math.random() > 0.1,
      delivery: Math.random() > 0.1,
      lat,
      lng,
      latitude: lat,
      longitude: lng,
      geocodedAt: new Date(),
      billings: [],
      visits: [],
      schedule: {
        create: {
          monday: Math.random() > 0.1,
          tuesday: Math.random() > 0.1,
          wednesday: Math.random() > 0.1,
          thursday: Math.random() > 0.1,
          friday: Math.random() > 0.1,
          saturday: Math.random() > 0.3,
          sunday: Math.random() > 0.3,
        }
      }
    });
  }

  try {
    console.log('Creating users...\n');
    
    for (let i = 0; i < users.length; i++) {
      const userData = users[i];
      const user = await prisma.user.create({
        data: userData,
        include: { schedule: true }
      });
      console.log(`✅ Created: ${user.first} ${user.last} (${user.city}, ${user.state})`);
    }
    
    console.log(`\n🎉 Successfully created ${users.length} fake users!`);
    
    // Show summary
    const total = await prisma.user.count();
    console.log(`\n📊 Total users in database: ${total}`);
    
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

