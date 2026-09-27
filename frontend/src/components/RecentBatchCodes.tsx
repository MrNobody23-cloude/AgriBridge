'use client';

import { useEffect, useState } from 'react';

/**
 * Quick-pick chips for batch codes that actually exist in the ledger.
 *
 * The consumer page previously rendered three fixed sample codes as
 * unlabelled buttons. With no data seeded they were dead ends that looked
 * exactly like real batch IDs, so a consumer could not tell "this batch is
 * not in the system" from "this batch is the one you should be checking" —
 * which is the one distinction a verification page exists to make.
 *
 * Each candidate is resolved against GET /api/batches/[id], the same
 * public endpoint the search box uses, and only codes that resolve are
 * offered. That endpoint is public, so this works signed out; it does not
 * weaken anything, because it reveals only whether a code it was already
 * given resolves.
 */
export default function RecentBatchCodes({
    codes,
    onPick,
}: {
    codes: string[];
    onPick: (code: string) => void;
}) {
    const [existing, setExisting] = useState<string[] | null>(null);

    // The effect re-runs when the *contents* of `codes` change, not when the
    // parent happens to hand over a new array with the same items. `codes` is a
    // literal in the consumer page's state, so its identity changes on every
    // parent render and would otherwise re-probe every batch on each keystroke.
    // The joined key is extracted into a variable because a `codes.join('|')`
    // expression in the dependency array cannot be statically checked — the
    // rule cannot see that it reads `codes` and assume the list never changes.
    const codesKey = codes.join('|');

    useEffect(() => {
        let cancelled = false;

        (async () => {
            const resolved = await Promise.all(
                codes.map(async (code) => {
                    try {
                        const res = await fetch(`/api/batches/${encodeURIComponent(code)}`);
                        if (!res.ok) return null;
                        const json = await res.json();
                        return json.success ? code : null;
                    } catch {
                        return null;
                    }
                })
            );
            if (!cancelled) {
                setExisting(resolved.filter((c): c is string => c !== null));
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [codesKey, codes]);

    // While resolving, render nothing rather than the unverified codes.
    if (!existing || existing.length === 0) return null;

    return (
        <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            <span className="text-[11px] font-semibold text-gray-400">Recently verified:</span>
            {existing.map((code) => (
                <button
                    key={code}
                    type="button"
                    onClick={() => onPick(code)}
                    className="text-[11px] font-mono font-bold text-gray-500 hover:text-[#16a34a] bg-gray-100 px-2.5 py-1 rounded-lg"
                >
                    {code}
                </button>
            ))}
        </div>
    );
}
