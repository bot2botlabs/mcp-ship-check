/**
 * Known advisories for the `mcp-remote` client bridge, checked offline by
 * `mcp-ship-check bridge`. Update this table as advisories are published or
 * fixes are confirmed upstream.
 *
 * `fixConfirmed: false` means the advisory lists no fixed release and no fix
 * has been verified in the source, so a version above the range is reported as
 * "outside the advisory's listed range (unconfirmed upstream fix)", never as
 * "patched". With `fixConfirmed: true`, `to` is the first fixed release, checked
 * against the upstream source.
 */
export interface BridgeAdvisory {
    /** Rule id reported by the check. */
    rule: string;
    cve: string;
    /** Inclusive lower bound, or undefined for "all earlier versions". */
    from?: string;
    /** Upper bound and whether it is inclusive. */
    to: string;
    toInclusive: boolean;
    summary: string;
    /** Flag that puts the vulnerable code path in use, if the bug is gated behind one. */
    gatedBy?: string;
    fixConfirmed: boolean;
    /** First release that carries the fix, and its upstream commit, when confirmed. */
    fixedIn?: string;
    fixCommit?: string;
    /** The advisory record's own range, when the fixed release shows it was narrower than the affected one. */
    recordRange?: string;
    /** Advice for an affected pin. */
    advice: string;
}
export declare const BRIDGE_ADVISORIES: BridgeAdvisory[];
