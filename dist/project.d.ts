export declare function optionalJson(path: string): Promise<any | undefined>;
export declare function project(dir: string): Promise<{
    dir: string;
    pkg: any;
    plugins: [string, any][];
    configs: [string, any][];
    manifest: any;
    server: any;
}>;
export declare function message(e: unknown): string;
