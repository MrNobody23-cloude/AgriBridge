import { NextRequest } from "next/server";
import { MongoClient } from "mongodb";
import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse } from "@/lib/response";
import { findUserByIdWithProfileSafe } from "@/lib/db/repositories/users";
import { connectToDatabase } from "@/lib/db/connection";

export const dynamic = "force-dynamic";

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
  if (!uri) throw new Error("MONGODB_URI is not set");

  nativeClientPromise = new MongoClient(uri, { maxPoolSize: 1 })
    .connect()
    .then((c) => {
      nativeClient = c;
      return c;
    })
    .catch((err) => {
      nativeClientPromise = null;
      throw err;
    });

  return nativeClientPromise;
}

// TEMPORARY fallback: Telegram chat IDs to match even if the user record has no
// `telegramId` field yet. Remove this once telegramId is stored on the user
// profile (or once n8n saves the registered phone in `phone_number`).
const FALLBACK_TELEGRAM_IDS: string[] = ["2025199433"];

export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult;
  const { user } = authResult;

  try {
    // Keep Mongoose connected for user repo lookups
    await connectToDatabase();

    const { searchParams } = new URL(req.url);
    // Accept both ?view= and ?mode= for backward compatibility
    const rawView = searchParams.get("view") || searchParams.get("mode");
    // Default: farmers see their own listings, exporters see the marketplace
    const view = rawView ?? (user.role === "FARMER" ? "farmer" : "market");

    let filter: Record<string, unknown> = {};

    if (view === "farmer") {
      // Phone from JWT; fall back to DB lookup. Use || (not ??) because old
      // JWTs may carry an explicit null.
      const dbUser = await findUserByIdWithProfileSafe(user.id);
      const phone: string | null = user.phone || dbUser?.phone || null;

      // Telegram chat ID stored on the user profile (if the field exists)
      const profileTelegramId = (
        dbUser as unknown as { telegramId?: string | number | null } | null
      )?.telegramId;

      console.log("[listings] farmer mode, phone:", phone);

      const clauses: Record<string, unknown>[] = [];

      // 1) Real phone number, in any stored format (+91, 91, 0, spaces, dashes,
      //    "tg:" prefix) — compared on the last 10 digits.
      if (phone) {
        const last10 = phone.replace(/\D/g, "").slice(-10);
        if (last10.length === 10) {
          const looseDigits = last10.split("").join("[\\s-]*") + "$";
          clauses.push(
            { phone_number: { $regex: looseDigits } }, // string formats
            { phone_number: Number(last10) }, // stored as number
            { phone_number: Number("91" + last10) }, // number with 91
          );
        }
      }

      // 2) Telegram chat IDs. n8n stores Telegram posts as "tg:<chat_id>".
      const telegramIds = [
        ...(profileTelegramId ? [String(profileTelegramId)] : []),
        ...FALLBACK_TELEGRAM_IDS,
      ].filter((v, i, arr) => v && arr.indexOf(v) === i);

      for (const id of telegramIds) {
        clauses.push({ phone_number: `tg:${id}` });
        clauses.push({ phone_number: id });
      }

      if (clauses.length === 0) {
        console.log("[listings] no phone or telegram id — returning empty");
        return successResponse({ listings: [], total: 0 });
      }

      filter = { $or: clauses };
      console.log("[listings] farmer filter:", JSON.stringify(filter));
    } else if (view === "market" || view === "exporter") {
      // NOTE: The n8n workflow does not set an 'intent' field on documents.
      // We fetch ALL produce records so exporters can browse available stock.
      // When intent is added to the workflow, switch this back to { intent: 'SELL' }.
      filter = {};
    } else {
      // No filter — return all
      filter = {};
    }

    console.log("[listings] view:", view);

    // Use the native MongoDB client to target Farmer_Info specifically
    const client = await getNativeClient();
    const db = client.db("Farmer_Info");

    const rawListings = await db
      .collection("products")
      .find(filter)
      .sort({ created_at: -1 })
      .limit(100)
      .toArray();

    // Serialize all non-JSON-safe types before returning
    const listings = rawListings.map((doc) => ({
      ...doc,
      _id: doc._id?.toString?.() ?? String(doc._id),
      // Map n8n field names → what the UI expects
      product_name: doc.product || doc.product_name || "Unknown",
      product: doc.product || doc.product_name || "Unknown",
      quantity: doc.quantity ?? null,
      unit: doc.unit ?? null,
      price: doc.price ?? null,
      price_unit: doc.price_unit ?? null,
      location: doc.location ?? null,
      listing_type: doc.intent ?? null,
      intent: doc.intent ?? null,
      status: doc.status ?? "active",
      contact_name: doc.contact_name ?? null,
      farmer_name: doc.contact_name ?? null,
      phone_number: doc.phone_number ?? null,
      // Convert Date objects / ISODate to ISO strings so Next.js can serialize
      // and the browser can parse them reliably.
      created_at: doc.created_at
        ? new Date(doc.created_at).toISOString()
        : null,
      createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
    }));

    console.log("[listings] Serialized Listings count:", listings.length);

    return successResponse({ listings, total: listings.length });
  } catch (error: unknown) {
    console.error("[listings] DB Error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return errorResponse(
      `Failed to fetch listings: ${msg}`,
      "FETCH_ERROR",
      500,
    );
  }
}
