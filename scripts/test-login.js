async function testLogin() {
    try {
        const res = await fetch('http://localhost:3000/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'admin@agribridge.test', password: 'SecretApp123!' })
        });
        const text = await res.text();
        console.log(`Status: ${res.status}`);
        console.log(`Body: ${text}`);
    } catch (e) {
        console.error('Fetch error:', e);
    }
}
testLogin();
