// Simple test script
console.log('Testing ArcPay Backend...\n');

const BASE_URL = 'http://localhost:3001';

async function testHealth() {
  try {
    const response = await fetch(`${BASE_URL}/health`);
    const data = await response.json();
    console.log('✓ Health check passed!');
    console.log(data);
  } catch (error) {
    console.log('✗ Health check failed:', error.message);
  }
}

console.log('Run "npm start" first, then run this test!\n');