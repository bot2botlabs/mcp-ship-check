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
