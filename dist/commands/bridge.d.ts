export interface BridgeOptions {
    strict?: boolean;
}
export declare function bridge(dir?: string, options?: BridgeOptions): Promise<import("../report.js").Outcome>;
