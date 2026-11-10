/**
 * Known advisories for the `mcp-remote` client bridge, checked offline by
 * `mcp-ship-check bridge`. Update this table as advisories are published or
 * fixes are confirmed upstream.
 *
 * `fixConfirmed: false` means the advisory lists no fixed release and no fix
 * has been verified in the source, so a version above the range is reported as
 * "outside the advisory's listed range (unconfirmed upstream fix)", never as
 * "patched".
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
  /** Advice for an affected pin. */
  advice: string;
}

export const BRIDGE_ADVISORIES: BridgeAdvisory[] = [
  {
    rule: 'bridge-cve-2025-6514',
    cve: 'CVE-2025-6514',
    to: '0.1.16',
    toInclusive: false,
    summary: 'OS command injection via a malicious server\'s OAuth authorization_endpoint',
    fixConfirmed: true,
    advice: 'upgrade to 0.1.16 or later',
  },
  {
    rule: 'bridge-cve-2026-108716',
    cve: 'CVE-2026-108716',
    from: '0.8.0',
    to: '0.14.3',
    toInclusive: true,
    summary: 'client secret and tokens can be sent over cleartext HTTP in the device-code grant',
    gatedBy: '--device-code',
    fixConfirmed: false,
    advice: 'move to a version outside the advisory\'s listed range (unconfirmed upstream fix)',
  },
];
