import { project } from '../project.js';
import { type Result } from '../report.js';
export declare function files(dir?: string): Promise<import("../report.js").Outcome>;
export declare function pluginChecks(p: Awaited<ReturnType<typeof project>>): Result[];
