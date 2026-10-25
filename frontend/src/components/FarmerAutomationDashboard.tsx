"use client";

import React, { useState, useEffect, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { errText } from "@/lib/err";
import type { ApiBatch } from "@/lib/api-types";
import BatchTable, { BatchRow } from "@/components/BatchTable";
import QRCode from "qrcode";

// ─── Types for n8n market listings ───────────────────────────────────────

interface MarketListing {
  _id: string;
  product_name: string;
  product?: string | null;
  quantity?: number | null;
  unit?: string | null;
  price?: number | null;
  price_unit?: string | null;
  location?: string | null;
  listing_type?: string | null;
  status?: string | null;
  created_at?: string | null;
  farmer_name?: string | null;
  notes?: string | null;
  createdAt?: string | null;
}

// The API returns dates as String(Date), e.g. "Mon Oct 26 2026 10:00:00 GMT...".
// Parse and format them; fall back to "N/A" if the value is missing or invalid.
const formatListingDate = (listing: MarketListing): string => {
  const raw = listing.created_at ?? listing.createdAt;
  if (!raw) return "N/A";
  const d = new Date(raw);
  return Number.isNaN(d.getTime())
    ? "N/A"
    : d.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
};

export default function FarmerAutomationDashboard() {
  // Batches state
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [qrModalData, setQrModalData] = useState<{
    code: string;
    url: string;
    qrDataUrl: string;
  } | null>(null);
  // What the last registration actually reported about the chain. Null until
  // a batch has been registered, and a reason string when the batch was not
  // anchored — which is the normal case unless a contract is deployed.
  const [lastChainReason, setLastChainReason] = useState<string | null>(null);
  const [lastChainChecked, setLastChainChecked] = useState(false);

  // n8n Produce Listings state (separate from batch loading)
  const [listings, setListings] = useState<MarketListing[]>([]);
  const [listingsLoading, setListingsLoading] = useState(true);
  const [listingsError, setListingsError] = useState<string | null>(null);

  // Form State
  const [crop, setCrop] = useState("Alphonso Mango");
  const [qty, setQty] = useState("2400");
  const [harvestDate, setHarvestDate] = useState("2026-03-12");
  const [location, setLocation] = useState("Nashik, Maharashtra");

  // Search State
  const [searchQuery, setSearchQuery] = useState("");

  const fetchBatches = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/batches${
          searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : ""
        }`,
      );
      const json = await res.json();
      if (json.success) {
        const rawBatches: ApiBatch[] = Array.isArray(json.data)
          ? json.data
          : Array.isArray(json.data?.batches)
          ? json.data.batches
          : [];
        const rows: BatchRow[] = rawBatches.map((b: ApiBatch) => ({
          id: b.batchCode,
          crop: b.product?.name || "Crop Batch",
          qty: `${(b.quantity || 0).toLocaleString()} kg`,
          quantity: Number(b.quantity || 0),
          unit: b.unit || "kg",
          harvestDate: b.harvestDate
            ? new Date(b.harvestDate).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })
            : "N/A",
          trustScore: b.trustScore,
          status: b.status,
        }));
        setBatches(rows);
      }
    } catch (e) {
      console.error("Failed to load batches:", e);
    } finally {
      setLoading(false);
    }
    // `loading` starts as `true` and is never set back at the top, so the first
    // paint is a spinner and no render is triggered before the fetch resolves.
    // A search therefore refetches behind the existing rows rather than
    // replacing the table with a spinner the farmer did not ask for.
  }, [searchQuery]);

  // Fetches this farmer's listings. `silent` = background refresh: it never
  // shows the spinner or clears/sets errors, so the grid doesn't flicker.
  const fetchListings = useCallback(async (silent = false) => {
    if (!silent) {
      setListingsLoading(true);
      setListingsError(null);
    }
    try {
      const res = await fetch("/api/listings?view=farmer", {
        cache: "no-store",
      });
      const json = await res.json();
      if (json.success) {
        setListings(json.data?.listings ?? []);
        setListingsError(null);
      } else if (!silent) {
        setListingsError(json.error?.message || "Failed to load listings");
      }
    } catch (e) {
      if (!silent) {
        setListingsError(errText(e) || "Network error loading listings");
      }
    } finally {
      if (!silent) setListingsLoading(false);
    }
  }, []);

  // Listings: initial load + poll every 30s + refresh when the tab is shown again
  useEffect(() => {
    Promise.resolve().then(() => fetchListings(false));
    const interval = setInterval(() => fetchListings(true), 30000);
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchListings(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchListings]);

  useEffect(() => {
    Promise.resolve().then(fetchBatches);
  }, [fetchBatches]);

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSuccessMsg("");

    try {
      const res = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          crop,
          quantity: parseFloat(qty) || 1000,
          harvestDate,
          location,
        }),
      });

      const json = await res.json();
      if (json.success) {
        const batchObj = json.data?.batch || json.data;
        const newBatchCode = batchObj?.batchCode;
        if (!newBatchCode) {
          alert("Batch created, but no batch code was returned");
          return;
        }
        const verifyUrl = `${window.location.origin}/verify/${newBatchCode}`;
        const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
          width: 300,
          margin: 2,
        });

        // Report what happened, not what we wish had happened. POST /api/batches
        // returns the chain result as `json.data.blockchain`, carrying both
        // `success` and a `reason` when nothing was written — so the message
        // can say "registered" without claiming a chain write that never
        // happened.
        const chain = json.data.blockchain;
        const anchored = chain?.success === true;
        setLastChainChecked(true);
        setLastChainReason(
          anchored ? null : chain?.reason ?? "Chain not configured",
        );
        setSuccessMsg(
          anchored
            ? `✓ Batch ${newBatchCode} registered and anchored on-chain.`
            : `✓ Batch ${newBatchCode} registered with a SHA-256 fingerprint${
                chain?.reason
                  ? ` — not anchored on-chain (${String(chain.reason)
                      .toLowerCase()
                      .replace(/_/g, " ")})`
                  : ""
              }.`,
        );
        setQrModalData({ code: newBatchCode, url: verifyUrl, qrDataUrl });
        fetchBatches();
      } else {
        alert(json.error?.message || "Failed to register batch");
      }
    } catch (err: unknown) {
      alert(errText(err) || "Server error while registering batch");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DashboardLayout title="Farmer Dashboard">
      {/* Top Banner Stats
          This banner previously showed `batches.length || 5`, a hardcoded
          "87 / 100" average trust score with a "Top 5% Nashik Region" ranking
          that nothing computes, a hardcoded "₹13,02,000 Gross Revenue (YTD)"
          with a "+32% Premium Export Price" delta, and a "Polygon Amoy / SHA-256
          Verified" card asserting a live chain state that this page never
          fetches. The six-month revenue chart had already been deleted from
          the panel below for exactly the reason that revenue cannot be shown
          here — there is no revenue, payment or price model in the schema — so
          the rupee tile contradicted the disclaimer sitting beneath it. */}

      {/* Main Grid: Form + Chart */}

      {/* Batch Table Section */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <input
            type="text"
            placeholder="🔍 Search batches by crop name, ID, or location..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full sm:w-80 text-xs font-medium text-[#1a1a1a] p-2.5 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#16a34a] focus:outline-none shadow-xs"
          />
          <button
            onClick={fetchBatches}
            className="text-xs font-bold text-[#16a34a] hover:underline flex items-center gap-1"
          >
            ↻ Refresh Ledger
          </button>
        </div>

        {/* `loading` is set on every fetch but was never rendered, so the table
            showed its "No batches to show." empty state during the request and
            on every refetch. An empty list and a list still loading are
            different facts, and only one of them is true here. */}
        {loading ? (
          <div className="glass-card py-12 flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-agro-green border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-gray-500 font-medium">
              Loading batches…
            </span>
          </div>
        ) : (
          <BatchTable rows={batches} />
        )}
      </div>

      {/* QR Code Download Modal */}
      {qrModalData && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full border border-gray-200 shadow-2xl text-center space-y-4 animate-scale-up">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <h3 className="text-sm font-bold text-[#1a1a1a]">
                Batch QR Authenticity Code
              </h3>
              <button
                onClick={() => setQrModalData(null)}
                className="text-gray-400 hover:text-gray-600 font-bold text-sm"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-[#FAFAF7] rounded-xl border border-gray-200 flex flex-col items-center">
              {/* `no-img-element` disabled deliberately. `qrDataUrl` is a
                  `data:image/png;base64,…` string produced in the browser by the
                  `qrcode` package — there is no URL for the Next.js image
                  optimizer to fetch, resize or re-encode, so `next/image` would
                  add a loader and a second decode pass for a lossless PNG that
                  is already exactly the size it is displayed at. The rule exists
                  to stop unoptimised JPEGs of remote photos; a base64 QR code is
                  the case where it does not apply. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrModalData.qrDataUrl}
                alt="Batch QR Code"
                className="w-48 h-48 rounded-lg shadow-sm"
              />
              <p className="mt-2 text-xs font-mono font-bold text-[#16a34a]">
                {qrModalData.code}
              </p>
            </div>

            <p className="text-xs text-gray-500">
              Attach this QR code to crop packaging. Exporters and consumers can
              scan it to view the traceability record.
            </p>

            <div className="flex gap-2 pt-2">
              <a
                href={qrModalData.qrDataUrl}
                download={`AgriBridge_${qrModalData.code}_QR.png`}
                className="flex-1 py-2.5 bg-[#16a34a] text-white text-xs font-bold rounded-xl text-center hover:bg-green-700"
              >
                Download PNG
              </a>
              <a
                href={qrModalData.url}
                target="_blank"
                rel="noreferrer"
                className="flex-1 py-2.5 bg-gray-100 text-gray-700 text-xs font-bold rounded-xl text-center hover:bg-gray-200"
              >
                Open Link →
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ── My Produce Listings (from n8n workflow) ──────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-[#1a1a1a] flex items-center gap-2">
              <span aria-hidden="true">🛒</span>
              <span>My Produce Listings</span>
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Active listings submitted via Telegram. Exporters can see these in
              the marketplace.
            </p>
          </div>
          <button
            onClick={() => fetchListings(false)}
            className="text-xs font-bold text-[#16a34a] hover:underline flex items-center gap-1"
          >
            ↻ Refresh
          </button>
        </div>

        {listingsLoading ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-xs py-10 flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-[#16a34a] border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-gray-500 font-medium">
              Loading your listings…
            </span>
          </div>
        ) : listingsError ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-700 font-semibold">
            ⚠️ {listingsError}
          </div>
        ) : listings.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center">
            <p className="text-sm font-semibold text-gray-500">
              No active listings found.
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Post a produce listing via the AgriBridge Telegram bot and it will
              appear here automatically.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {listings.map((listing, idx) => {
              const isTypeSell =
                (listing.listing_type || "SELL").toUpperCase() === "SELL";
              const statusLabel = listing.status || "Active";
              const isListingActive = statusLabel.toLowerCase() === "active";
              const displayDate = formatListingDate(listing);
              return (
                <div
                  key={listing._id || idx}
                  className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs hover:shadow-sm transition-shadow"
                >
                  {/* Header row */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-[#1a1a1a] truncate capitalize">
                        {listing.product_name || listing.product || "Unknown"}
                      </p>
                      {listing.location && (
                        <p className="text-[11px] text-gray-500 mt-0.5 truncate">
                          📍 {listing.location}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 ml-2 shrink-0">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                          isTypeSell
                            ? "bg-green-100 text-green-700"
                            : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {listing.listing_type || "SELL"}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-600">
                        {listing.status || "active"}
                      </span>
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="p-2 bg-[#FAFAF7] rounded-lg border border-gray-100">
                      <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">
                        Quantity
                      </p>
                      <p className="text-sm font-extrabold text-[#1a1a1a] mt-0.5">
                        {listing.quantity != null
                          ? `${Number(listing.quantity).toLocaleString()} ${
                              listing.unit || "kg"
                            }`
                          : "—"}
                      </p>
                    </div>
                    <div className="p-2 bg-[#FAFAF7] rounded-lg border border-gray-100">
                      <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">
                        Price
                      </p>
                      <p className="text-sm font-extrabold text-[#16a34a] mt-0.5">
                        {listing.price != null
                          ? `₹${Number(listing.price).toLocaleString("en-IN")}${
                              listing.price_unit ? `/${listing.price_unit}` : ""
                            }`
                          : "Not set"}
                      </p>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between border-t border-gray-100 pt-2">
                    <span className="text-[10px] text-gray-400 font-medium">
                      Listed: {displayDate}
                    </span>
                    <span
                      className={`text-[10px] font-bold ${
                        isListingActive ? "text-[#16a34a]" : "text-gray-500"
                      }`}
                    >
                      ● {statusLabel}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
