export interface ToolsOptions {
    cmd?: string;
    timeout?: number;
    env?: Record<string, string>;
}
export declare function tools(dir?: string, options?: ToolsOptions): Promise<import("../report.js").Outcome>;
