export { canonicalizeDeployIrV2, canonicalizeJson } from './canonical.js';
export { DeployIrV2ParseError, parseDeployIrV2, parseDeployIrV2Json, type DeployIrV2ParseErrorCode } from './parse.js';
export { parseJsonWithoutDuplicateKeys } from './strict-json.js';
export { upgradeDeployIrV1, type LegacyTargetConfigV2, type UpgradeDeployIrV1Result } from './upgrade-v1.js';
export * from './types.js';
