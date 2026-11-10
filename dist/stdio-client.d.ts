export interface Tool {
    name: string;
    description?: string;
}
export declare function listTools(command: string, cwd: string, timeout: number, env?: Record<string, string>): Promise<Tool[]>;
