/**
 * Regression tests for the honesty rules.
 *
 * These lock in behaviour that used to be actively dishonest, and that nothing
 * else in the suite would catch:
 *
 *   1. The blockchain layer used to contain a mock that derived its "on-chain
 *      hash" from the database hash, so verification was a tautology that
 *      always returned true and always explained itself as a Polygon record.
 *   2. `registerBatchOnChain` used to fabricate a transaction hash from
 *      SHA-256 + Date.now() and a block number from Math.random() when the
 *      chain was unset.
 *
 * Both now resolve to an explicit NOT_CONFIGURED answer, and these tests fail
 * if anyone reintroduces a fabricated proof.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Blockchain honesty', () => {
    const savedEnv = { ...process.env };

    beforeEach(() => {
        // Unset every blockchain variable, including ones a developer's shell
        // or a CI secret may have injected, so the module is evaluated in the
        // genuinely unconfigured state.
        delete process.env.BLOCKCHAIN_CONTRACT_ADDRESS;
        delete process.env.CONTRACT_ADDRESS;
        delete process.env.BLOCKCHAIN_PRIVATE_KEY;
        delete process.env.PRIVATE_KEY;
        delete process.env.POLYGON_RPC_URL;
        delete process.env.NEXT_PUBLIC_POLYGON_RPC_URL;
        delete process.env.BLOCKCHAIN_NETWORK;
    });

    afterEach(() => {
        process.env = { ...savedEnv };
    });

    it('reports NOT_CONFIGURED rather than fabricating a transaction hash', async () => {
        const { registerBatchOnChain } = await import('../src/lib/blockchain');

        const result = await registerBatchOnChain('AGR-2026-IN-000001', '0xabc123');

        expect(result.success).toBe(false);
        expect(result.mode).toBe('not_configured');
        expect(result.reason).toBe('BLOCKCHAIN_NOT_CONFIGURED');
        // The old mock returned a SHA-256 of the input plus Date.now() here.
        expect(result.transactionHash).toBeNull();
        expect(result.blockNumber).toBeNull();
    });

    it('never claims a batch is verified when no chain is configured', async () => {
        const { verifyBatchOnChain } = await import('../src/lib/blockchain');

        const result = await verifyBatchOnChain('AGR-2026-IN-000001', '0xabc123');

        expect(result.verified).toBe(false);
        expect(result.status).toBe('NOT_CONFIGURED');
        // Not TAMPERED: a chain nobody is watching cannot prove anything.
        expect(result.status).not.toBe('TAMPERED');
        expect(result.blockchainHash).toBeNull();
    });

    it('is not vulnerable to the tautology that made the old mock always pass', async () => {
        const { verifyBatchOnChain } = await import('../src/lib/blockchain');

        // The old mock computed `mockBlockchainHash = databaseHash` and compared
        // the two, so this exact call returned verified: true.
        const result = await verifyBatchOnChain('AGR-2026-IN-000001', '0xabc123');

        expect(result.verified).not.toBe(true);
    });

    it('still produces a real SHA-256 for the batch fingerprint', async () => {
        const { generateBatchHash } = await import('../src/lib/blockchain');

        const hash = generateBatchHash({
            batchCode: 'AGR-2026-IN-000001',
            farmerId: 'farmer-1',
            crop: 'Turmeric',
            quantity: 500,
            harvestDate: '2026-09-01',
            location: 'Nashik, MH',
        });

        expect(hash).toMatch(/^0x[0-9a-f]{64}$/);

        // A different payload must produce a different fingerprint, otherwise
        // the "cryptographic" hash is not binding on any of its inputs.
        const other = generateBatchHash({
            batchCode: 'AGR-2026-IN-000001',
            farmerId: 'farmer-2',
            crop: 'Turmeric',
            quantity: 500,
            harvestDate: '2026-09-01',
            location: 'Nashik, MH',
        });
        expect(other).not.toBe(hash);
    });

    it('exposes a configuration check callers can use without a network call', async () => {
        const { isBlockchainConfigured } = await import('../src/lib/blockchain');
        expect(isBlockchainConfigured()).toBe(false);
    });
});
