export interface Args {
    command?: string;
    dir: string;
    json: boolean;
    help: boolean;
    version: boolean;
    cmd?: string;
    timeout: number;
    env: Record<string, string>;
    glama: boolean;
    glamaUrl?: string;
    strict: boolean;
}
export declare function parseArgs(argv: string[]): Args;
