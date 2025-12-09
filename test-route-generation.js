// test-route-generation.js
// Quick test to trigger route generation and see debug output

async function testRouteGeneration() {
    console.log('Testing route generation for "all" day...\n');

    try {
        const response = await fetch('http://localhost:3000/api/route/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                day: 'all',
                driverCount: 6,
                useDietFantasyStart: true
            })
        });

        const data = await response.json();

        console.log('\n=== Response ===');
        console.log('Status:', response.status);
        console.log('OK:', data.ok);
        console.log('Message:', data.message);
        console.log('\nSummary:', JSON.stringify(data.summary, null, 2));

        if (data.ok) {
            console.log('\n✅ Route generation completed successfully!');
            console.log('Check the server console for debug logs about YAKOV LAMM and YIDIS STEINER');
        } else {
            console.log('\n❌ Route generation failed:', data.error);
        }
    } catch (error) {
        console.error('❌ Error calling API:', error.message);
    }
}

testRouteGeneration();
