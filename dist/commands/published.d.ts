export declare class HttpError extends Error {
    status: number;
    constructor(status: number);
}
export type FetchJson = (url: string, timeoutMs: number) => Promise<any>;
export declare const fetchJson: FetchJson;
export interface PublishedOptions {
    timeout?: number;
    glama?: boolean;
    glamaUrl?: string;
    fetchJson?: FetchJson;
}
export declare function published(dir?: string, options?: PublishedOptions): Promise<import("../report.js").Outcome>;
