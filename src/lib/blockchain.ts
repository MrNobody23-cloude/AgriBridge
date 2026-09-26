import { ethers } from 'ethers';
import crypto from 'crypto';

const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL || 'https://rpc-amoy.polygon.technology';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

/**
 * Whether this deployment can actually write to a chain.
 *
 * There is no `mock` mode. The previous one compared a hash against itself
 * (`const mockBlockchainHash = databaseHash`), so `verified` was always true
 * and the caller was told "Cryptographic SHA-256 hash matches 100% on Polygon
 * Amoy Blockchain" for a batch that had never touched a chain. A fabricated
 * transaction hash and a random block number were returned as if a real
 * transaction had been mined, and that fed 20 free points into the trust score
 * on every batch.
 *
 * Unconfigured is now a first-class answer, reported as NOT_CONFIGURED with a
 * reason, and it scores nothing. See docs/BLOCKCHAIN.md.
 */
export function isBlockchainConfigured(): boolean {
    return Boolean(CONTRACT_ADDRESS && CONTRACT_ADDRESS.trim() !== '');
}

/** Can we *write*? Verification only needs a read provider and an address. */
function isBlockchainWritable(): boolean {
    return isBlockchainConfigured() && Boolean(PRIVATE_KEY && PRIVATE_KEY.trim() !== '');
}

function notConfiguredReason(writing: boolean): string {
    const missing = [
        !CONTRACT_ADDRESS || CONTRACT_ADDRESS.trim() === '' ? 'CONTRACT_ADDRESS' : null,
        writing && (!PRIVATE_KEY || PRIVATE_KEY.trim() === '') ? 'PRIVATE_KEY' : null,
    ].filter(Boolean);
    return (
        `BLOCKCHAIN_NOT_CONFIGURED: no contract to read or write. ` +
        `Set ${missing.join(' and ')} in the environment. ` +
        `Nothing was recorded on a chain and nothing is claimed about one.`
    );
}

export function blockchainConfiguration(): { configured: boolean; writable: boolean; reason: string | null } {
    const configured = isBlockchainConfigured();
    return {
        configured,
        writable: isBlockchainWritable(),
        reason: configured ? null : notConfiguredReason(false),
    };
}

// ABI of AgriBridgeTraceability contract
export const AGRIBRIDGE_CONTRACT_ABI = [
    'function registerBatch(string _batchId, string _cryptographicHash) public',
    // Five parameters. This was previously declared with four — `_actorRole`
    // was missing — which would have reverted every real-mode event write.
    'function addSupplyChainEvent(string _batchId, string _eventType, string _actorRole, string _location, string _metadata) public',
    'function verifyBatch(string _batchId) public view returns (string cryptographicHash, uint256 timestamp, address registeredBy, bool exists)',
    'function getBatchHash(string _batchId) public view returns (string)',
    'event BatchRegistered(string indexed batchId, string cryptographicHash, address indexed registeredBy, uint256 timestamp)',
];

export type ChainMode = 'real' | 'not_configured';

export interface ChainResult {
    /** True only when a real transaction was confirmed by a real receipt. */
    success: boolean;
    batchId: string;
    cryptographicHash: string;
    /** null unless a real transaction was mined. Never synthesised. */
    transactionHash: string | null;
    blockNumber: number | null;
    mode: ChainMode;
    /** Machine-readable discriminator: BLOCKCHAIN_NOT_CONFIGURED, etc. */
    reason: string | null;
}

export type ChainStatus = 'VERIFIED' | 'TAMPERED' | 'NOT_FOUND' | 'NOT_CONFIGURED' | 'UNREACHABLE';

export interface ChainVerification {
    verified: boolean;
    status: ChainStatus;
    /** null when no chain was consulted — never the database hash echoed back. */
    blockchainHash: string | null;
    transactionHash: string | null;
    mode: ChainMode;
    explanation: string;
    reason: string | null;
}

/**
 * Generate deterministic SHA-256 cryptographic hash for a crop batch payload.
 *
 * This is a real digest of real inputs. It is *not* proof of anything on its
 * own — it only means the batch record can later be shown not to have changed.
 */
export function generateBatchHash(payload: {
    batchCode: string;
    farmerId: string;
    crop: string;
    quantity: number;
    harvestDate: string;
    location: string;
}): string {
    const rawString = `${payload.batchCode}|${payload.farmerId}|${payload.crop}|${payload.quantity}|${payload.harvestDate}|${payload.location}`;
    return '0x' + crypto.createHash('sha256').update(rawString).digest('hex');
}

/**
 * Generate SHA-256 hash of a file buffer or string content (e.g. certificates).
 */
export function generateFileHash(fileBuffer: Buffer | string): string {
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

/**
 * Record batch registration on Polygon.
 *
 * Returns `success: false` and `mode: 'not_configured'` when no contract is
 * configured, and `success: false` with the real error when a configured chain
 * is unreachable or reverts. It never falls back to a synthesised transaction
 * hash, and a real-mode failure is never reported as a success.
 */
export async function registerBatchOnChain(
    batchId: string,
    cryptographicHash: string
): Promise<ChainResult> {
    if (!isBlockchainWritable()) {
        const reason = notConfiguredReason(true);
        console.warn(`[blockchain] ${reason}`);
        return {
            success: false,
            batchId,
            cryptographicHash,
            transactionHash: null,
            blockNumber: null,
            mode: 'not_configured',
            reason: 'BLOCKCHAIN_NOT_CONFIGURED',
        };
    }

    try {
        const provider = new ethers.JsonRpcProvider(POLYGON_RPC_URL);
        const wallet = new ethers.Wallet(PRIVATE_KEY as string, provider);
        const contract = new ethers.Contract(
            CONTRACT_ADDRESS as string,
            AGRIBRIDGE_CONTRACT_ABI,
            wallet
        );

        const tx = await contract.registerBatch(batchId, cryptographicHash);
        const receipt = await tx.wait();

        return {
            success: true,
            batchId,
            cryptographicHash,
            transactionHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            mode: 'real',
            reason: null,
        };
    } catch (error: any) {
        // A chain that is configured but fails is a failure, not a mock. The
        // batch is still created in the database, without a chain record.
        const reason = `BLOCKCHAIN_WRITE_FAILED: ${error?.message ?? String(error)}`;
        console.error(`[blockchain] ${reason}`);
        return {
            success: false,
            batchId,
            cryptographicHash,
            transactionHash: null,
            blockNumber: null,
            mode: 'real',
            reason: 'BLOCKCHAIN_WRITE_FAILED',
        };
    }
}

/**
 * Verify a batch hash against the chain.
 *
 * When no chain is configured this returns `verified: false`,
 * `status: 'NOT_CONFIGURED'` and `blockchainHash: null`. Callers must treat that
 * as *unverifiable*, not as a pass and not as a failure: a batch cannot be
 * proven tampered with by a chain nobody is looking at.
 */
export async function verifyBatchOnChain(
    batchId: string,
    databaseHash: string
): Promise<ChainVerification> {
    if (!isBlockchainConfigured()) {
        const reason = notConfiguredReason(false);
        return {
            verified: false,
            status: 'NOT_CONFIGURED',
            blockchainHash: null,
            transactionHash: null,
            mode: 'not_configured',
            reason: 'BLOCKCHAIN_NOT_CONFIGURED',
            explanation: reason,
        };
    }

    try {
        const provider = new ethers.JsonRpcProvider(POLYGON_RPC_URL);
        const contract = new ethers.Contract(
            CONTRACT_ADDRESS as string,
            AGRIBRIDGE_CONTRACT_ABI,
            provider
        );

        const result = await contract.verifyBatch(batchId);
        if (!result.exists) {
            return {
                verified: false,
                status: 'NOT_FOUND',
                blockchainHash: null,
                transactionHash: null,
                mode: 'real',
                reason: 'BATCH_NOT_ON_CHAIN',
                explanation: `Batch ${batchId} has no record on the configured contract at ${CONTRACT_ADDRESS}.`,
            };
        }

        const chainHash: string = result.cryptographicHash;
        const isMatch = chainHash.toLowerCase() === (databaseHash || '').toLowerCase();

        return {
            verified: isMatch,
            status: isMatch ? 'VERIFIED' : 'TAMPERED',
            blockchainHash: chainHash,
            transactionHash: null,
            mode: 'real',
            reason: isMatch ? null : 'HASH_MISMATCH',
            explanation: isMatch
                ? 'Database SHA-256 matches the hash recorded on-chain.'
                : `HASH MISMATCH: database (${(databaseHash || '').slice(0, 10)}...) does not ` +
                  `match on-chain (${chainHash.slice(0, 10)}...). Possible record tampering.`,
        };
    } catch (error: any) {
        // Configured but unreachable. This is not a pass and not tampering.
        const reason = `BLOCKCHAIN_UNREACHABLE: ${error?.message ?? String(error)}`;
        console.error(`[blockchain] ${reason}`);
        return {
            verified: false,
            status: 'UNREACHABLE',
            blockchainHash: null,
            transactionHash: null,
            mode: 'real',
            reason: 'BLOCKCHAIN_UNREACHABLE',
            explanation: reason,
        };
    }
}
