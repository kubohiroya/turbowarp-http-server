import type { DeployIr } from './ir.js';
export type GeneratedFiles = Record<string, string>;
export declare function generateCloudflareWorker(ir: DeployIr): GeneratedFiles;
