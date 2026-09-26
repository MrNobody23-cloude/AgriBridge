// Environment setup for testing
process.env.AUTH_SECRET = 'test_secret_for_agribridge_jwt';
process.env.DATABASE_URL = 'postgresql://dummy:dummy@localhost:5432/agribridge_test';

import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { requireAuth, requirePermission, generateToken, hashPassword, comparePassword } from '../src/lib/auth';
import { ROLES } from '../src/lib/permissions';
import { prisma } from '../src/lib/prisma'; // Assumes mock setup if needed

describe('Authentication & Authorization Flow', () => {

    it('should correctly hash and match passwords securely', async () => {
        const password = 'TestPassword123!';
        const hash = await hashPassword(password);

        expect(hash).not.toBe(password);
        expect(await comparePassword(password, hash)).toBe(true);
        expect(await comparePassword('WrongPassword', hash)).toBe(false);
    });

    it('should generate a valid JWT token', () => {
        const payload = {
            id: 'u-1',
            email: 'farmer@agribridge.test',
            name: 'Test Farmer',
            role: 'FARMER'
        };
        const token = generateToken(payload);
        expect(typeof token).toBe('string');
        expect(token.split('.').length).toBe(3);
    });

    // Mocking for request handling
    const createMockRequest = (token?: string) => {
        const req = new NextRequest('http://localhost:3000/api/test', {
            headers: new Headers(token ? { 'Authorization': `Bearer ${token}` } : {})
        });
        return req;
    };

    it('requireAuth should reject missing tokens with 401', async () => {
        const req = createMockRequest();

        // Mock cookies() which requireAuth implicitly calls
        vi.mock('next/headers', () => ({
            cookies: vi.fn(() => ({ get: vi.fn(() => undefined) }))
        }));

        const result = await requireAuth(req) as any;
        expect(result.status).toBe(401);

        const json = await result.json();
        expect(json.success).toBe(false);
        expect(json.error.code).toBe('UNAUTHORIZED');
    });

    it('requireAuth should reject invalid tokens with 401', async () => {
        const req = createMockRequest('invalid.jwt.token');

        const result = await requireAuth(req) as any;
        expect(result.status).toBe(401);
        const json = await result.json();
        expect(json.error.code).toBe('INVALID_TOKEN');
    });

    it('requireAuth should allow authenticated users', async () => {
        const token = generateToken({ id: '1', email: 'test@test.com', name: 'User', role: 'FARMER' });
        const req = createMockRequest(token);

        const result = await requireAuth(req) as { user: any };
        expect(result.user).toBeDefined();
        expect(result.user.role).toBe('FARMER');
    });

    it('requirePermission should reject unauthorized roles with 403', async () => {
        // Consumer should not have users:manage permission
        const token = generateToken({ id: '2', email: 'c@test.com', name: 'Consumer', role: 'CONSUMER' });
        const req = createMockRequest(token);

        const result = await requirePermission(req, 'users:manage') as any;
        expect(result.status).toBe(403);
        const json = await result.json();
        expect(json.error.code).toBe('FORBIDDEN');
    });

    it('requirePermission should allow authorized roles', async () => {
        // Admin should have users:manage permission
        const token = generateToken({ id: '3', email: 'admin@test.com', name: 'Admin', role: 'ADMIN' });
        const req = createMockRequest(token);

        const result = await requirePermission(req, 'users:manage') as { user: any };
        expect(result.user).toBeDefined();
        expect(result.user.role).toBe('ADMIN');
    });

});
