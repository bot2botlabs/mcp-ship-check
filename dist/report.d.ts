export type Level = 'error' | 'warn' | 'info' | 'ok' | 'skip';
export interface Result {
    id: string;
    level: Level;
    message: string;
    details?: unknown;
}
export interface Report {
    command: string;
    ok: boolean;
    results: Result[];
}
export interface Outcome {
    report: Report;
    exitCode: number;
}
export declare function finish(command: string, results: Result[], couldNotRun?: boolean): Outcome;
export declare function unavailable(command: string, message: string): Outcome;
export declare function print(outcome: Outcome, json: boolean): void;
