import { NextRequest } from 'next/server';
import { requireAuth, requirePermission, generateToken, hashPassword, comparePassword } from '../src/lib/auth';

process.env.AUTH_SECRET = 'test_secret_for_agribridge_jwt';
process.env.DATABASE_URL = 'postgresql://dummy:dummy@localhost:5432/agribridge_test';

async function runTests() {
    console.log('--- RUNNING AUTHENTICATION & RBAC TESTS ---');
    let passed = 0;
    let failed = 0;

    const assert = (condition: boolean, testName: string) => {
        if (condition) {
            console.log(`✅ [PASS] ${testName}`);
            passed++;
        } else {
            console.error(`❌ [FAIL] ${testName}`);
            failed++;
        }
    };

    try {
        // Test 1: Password hashing
        const password = 'TestPassword123!';
        const hash = await hashPassword(password);
        assert(hash !== password && await comparePassword(password, hash) && !(await comparePassword('Wrong', hash)), 'Passwords hash and match correctly');

        // Test 2: JWT Generation
        const token = generateToken({ id: 'u-1', email: 'test@t.com', name: 'User', role: 'FARMER' });
        assert(typeof token === 'string' && token.split('.').length === 3, 'JWT Token generation successfully creates 3-part string');

        // Setup mock request builder
        const createMockRequest = (t?: string) => {
            return new NextRequest('http://localhost:3000/api/test', {
                headers: new Headers(t ? { 'Authorization': `Bearer ${t}` } : {})
            });
        };

        // Test 3: Require Auth - Unauthorized
        const reqUnauth = createMockRequest();
        const unauthRes = await requireAuth(reqUnauth) as any;
        assert(unauthRes.status === 401, 'requireAuth rejects missing tokens with 401');

        // Test 4: Require Auth - Authorized
        const reqAuth = createMockRequest(token);
        const authRes = await requireAuth(reqAuth) as { user: any };
        assert(authRes.user && authRes.user.role === 'FARMER', 'requireAuth allows valid tokens and returns User object');

        // Test 5: Role-based permissions - Consumer lacking users:manage
        const consumerToken = generateToken({ id: 'c-1', email: 'c@t.com', name: 'C', role: 'CONSUMER' });
        const reqConsumer = createMockRequest(consumerToken);
        const permRes = await requirePermission(reqConsumer, 'users:manage') as any;
        assert(permRes.status === 403, 'requirePermission rejects unauthorized roles (Consumer -> users:manage)');

        // Test 6: Role-based permissions - Admin having users:manage
        const adminToken = generateToken({ id: 'a-1', email: 'a@t.com', name: 'A', role: 'ADMIN' });
        const reqAdmin = createMockRequest(adminToken);
        const adminPermRes = await requirePermission(reqAdmin, 'users:manage') as { user: any };
        assert(adminPermRes.user && adminPermRes.user.role === 'ADMIN', 'requirePermission allows authorized roles (Admin -> users:manage)');

    } catch (err) {
        console.error('An exception occurred during testing:', err);
        failed++;
    }

    console.log('\n--- TEST RESULTS ---');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    if (failed > 0) process.exit(1);
}

runTests();
