import type {SchemaBundle, SchemaDocument} from '@kubohiroya/turbowarp-extension-data-editor/schema';
import document from '../schemas/block-editor-fixed-inputs.schema.json' with {type: 'json'};
const repository = "turbowarp-http-server";
/** The owner JSON document is canonical; this selects a primitive field fragment. */
export function fixedInputBundle(opcode: string, argument: string): SchemaBundle {
  const pointer = `#/$defs/${opcode}/properties/${argument}`;
  const source = {repository, path: 'schemas/block-editor-fixed-inputs.schema.json', symbol: pointer};
  const blocks = document.$defs as Record<string, {properties: Record<string, SchemaDocument>}>;
  return {identity: {ownerId: repository, contractId: opcode, revision: 'fixed-inputs-v1', variantId: argument},
    dialect: '2020-12', root: {retrievalUri: document.$id, document: blocks[opcode]!.properties[argument]!,
      artifact: {role: 'canonical-schema', source}},
    resources: [],
    provenance: {canonicalSources: [source, {repository, path: 'src/extension.ts', symbol: opcode}],
      generatedFiles: [], referenceSchemas: [], generationSources: []}};
}
