import { NextRequest } from 'next/server';
import { MongoClient } from 'mongodb';
import { requireAuth } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/response';
import { findUserByIdWithProfileSafe } from '@/lib/db/repositories/users';
import { connectToDatabase } from '@/lib/db/connection';

// ─── Singleton native MongoClient (separate from the Mongoose one) ─────────────
// We need to hit the Farmer_Info database specifically, which is a different DB
// from the default one Mongoose connects to. Mongoose's connection.getClient()
// works but uses the default DB; we call client.db('Farmer_Info') explicitly.

let nativeClient: MongoClient | null = null;
let nativeClientPromise: Promise<MongoClient> | null = null;

async function getNativeClient(): Promise<MongoClient> {
    if (nativeClient) return nativeClient;
    if (nativeClientPromise) return nativeClientPromise;

    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is not set');

    nativeClientPromise = new MongoClient(uri, { maxPoolSize: 1 }).connect().then((c) => {
        nativeClient = c;
        return c;
    }).catch((err) => {
        nativeClientPromise = null;
        throw err;
    });

    return nativeClientPromise;
}

export async function GET(req: NextRequest) {
    const authResult = await requireAuth(req);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    try {
        // Keep Mongoose connected for user repo lookups
        await connectToDatabase();

        const { searchParams } = new URL(req.url);
        // Accept both ?view= and ?mode= for backward compatibility
        const rawView = searchParams.get('view') || searchParams.get('mode');
        // Default: farmers see their own listings, exporters see the marketplace
        const view = rawView ?? (user.role === 'FARMER' ? 'farmer' : 'market');

        let filter: Record<string, unknown> = {};

        if (view === 'farmer') {
            // Get phone from JWT; fall back to DB lookup if not in token.
            // Use || (not ??) because old JWTs may carry explicit null (not undefined).
            let phone: string | null = user.phone || null;
            if (!phone) {
                const dbUser = await findUserByIdWithProfileSafe(user.id);
                phone = dbUser?.phone || null;
            }

            console.log('[listings] farmer mode, phone from JWT/DB:', phone);

            if (!phone) {
                console.log('[listings] no phone found — returning empty');
                return successResponse({ listings: [], total: 0 });
            }

            // n8n stores phones inconsistently — try multiple variants:
            // raw phone, phone with 91 prefix stripped, tg: prefix variant
            const stripped = phone.replace(/^(\+?91|0)/, '');
            const phoneVariants = [
                phone,
                stripped,
                `91${stripped}`,
                `tg:${phone}`,
                `tg:${stripped}`,
            ].filter((v, i, arr) => arr.indexOf(v) === i); // deduplicate

            console.log('[listings] trying phone variants:', phoneVariants);
            filter = { phone_number: { $in: phoneVariants } };

        } else if (view === 'market' || view === 'exporter') {
            // NOTE: The n8n workflow does not set an 'intent' field on documents.
            // We fetch ALL produce records so exporters can browse available stock.
            // When intent is added to the workflow, switch this back to { intent: 'SELL' }.
            filter = {};
        } else {
            // No filter — return all
            filter = {};
        }

        console.log('[listings] view:', view, '| filter:', JSON.stringify(filter));

        // Use the native MongoDB client to target Farmer_Info specifically
        const client = await getNativeClient();
        const db = client.db('Farmer_Info');

        const rawListings = await db
            .collection('products')
            .find(filter)
            .sort({ created_at: -1 })
            .limit(100)
            .toArray();

        // Serialize all non-JSON-safe types before returning
        const listings = rawListings.map((doc) => ({
            ...doc,
            _id: doc._id?.toString?.() ?? String(doc._id),
            // Map n8n field names → what the UI expects
            product_name: doc.product || doc.product_name || 'Unknown',
            product: doc.product || doc.product_name || 'Unknown',
            quantity: doc.quantity ?? null,
            unit: doc.unit ?? null,
            price: doc.price ?? null,
            price_unit: doc.price_unit ?? null,
            location: doc.location ?? null,
            listing_type: doc.intent ?? null,
            intent: doc.intent ?? null,
            status: doc.status ?? 'active',
            contact_name: doc.contact_name ?? null,
            farmer_name: doc.contact_name ?? null,
            phone_number: doc.phone_number ?? null,
            // Convert Date objects / ISODate to string so Next.js can serialize
            created_at: doc.created_at ? String(doc.created_at) : null,
            createdAt: doc.createdAt ? String(doc.createdAt) : null,
        }));

        console.log('[listings] Serialized Listings count:', listings.length);
        if (listings.length > 0) {
            console.log('[listings] Sample doc fields:', Object.keys(listings[0]));
        }

        return successResponse({ listings, total: listings.length });

    } catch (error: unknown) {
        console.error('[listings] DB Error:', error);
        const msg = error instanceof Error ? error.message : String(error);
        return errorResponse(`Failed to fetch listings: ${msg}`, 'FETCH_ERROR', 500);
    }
}