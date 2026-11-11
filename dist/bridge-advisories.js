export const BRIDGE_ADVISORIES = [
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
        // The CVE record lists 0.8.0-0.14.3. The device-code grant first enforces
        // HTTPS on its device-authorization and token endpoints in mcp-remote
        // v0.16.6 (commit e4dc371, "require https for the device grant
        // (CVE-2026-108716)"); 0.14.4-0.16.5 still lack that check.
        rule: 'bridge-cve-2026-108716',
        cve: 'CVE-2026-108716',
        from: '0.8.0',
        to: '0.16.6',
        toInclusive: false,
        summary: 'client secret and tokens can be sent over cleartext HTTP in the device-code grant',
        gatedBy: '--device-code',
        fixConfirmed: true,
        fixedIn: '0.16.6',
        fixCommit: 'e4dc371',
        recordRange: '0.8.0–0.14.3',
        advice: 'upgrade to 0.16.6 or later, which enforces HTTPS on the device-code endpoints',
    },
];
