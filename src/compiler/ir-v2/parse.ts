import {parseJsonWithoutDuplicateKeys} from './strict-json.js';
import {
  DEPLOY_IR_V2_VERSION,
  type AtomicValueTypeV2,
  type AuthPolicyV2,
  type BinaryRefDescriptorV2,
  type BindingDeclarationV2,
  type BindingTypeV2,
  type CapabilityRequirementV2,
  type DeployIrV2,
  type ExpressionIrV2,
  type HttpMethodV2,
  type JsonValue,
  type RouteIrV2,
  type SourceRefV2,
  type StatementIrV2,
  type ValueTypeV2
} from './types.js';

const METHODS = new Set<HttpMethodV2>(['ALL', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const ATOMIC_TYPES = new Set<AtomicValueTypeV2>([
  'null',
  'boolean',
  'number',
  'string',
  'json-array',
  'json-object',
  'binary-ref'
]);
const BINDING_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ATOMIC_TYPE_ORDER: readonly AtomicValueTypeV2[] = [
  'null',
  'boolean',
  'number',
  'string',
  'json-array',
  'json-object',
  'binary-ref'
];

export type DeployIrV2ParseErrorCode =
  | 'TW2_IR_JSON_SYNTAX'
  | 'TW2_IR_DUPLICATE_KEY'
  | 'TW2_IR_VERSION'
  | 'TW2_IR_UNKNOWN_FIELD'
  | 'TW2_IR_UNKNOWN_NODE'
  | 'TW2_IR_INVALID_VALUE';

export class DeployIrV2ParseError extends Error {
  public readonly name = 'DeployIrV2ParseError';

  public constructor(
    public readonly code: DeployIrV2ParseErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
  }
}

export function parseDeployIrV2Json(text: string): DeployIrV2 {
  return withParseDiagnostic(() => parseDeployIrV2Value(parseJsonWithoutDuplicateKeys(text)));
}

export function parseDeployIrV2(value: unknown): DeployIrV2 {
  return withParseDiagnostic(() => parseDeployIrV2Value(value));
}

function parseDeployIrV2Value(value: unknown): DeployIrV2 {
  const root = object(value, 'IR');
  exactKeys(root, ['version', 'name', 'auth', 'capabilities', 'routes'], 'IR');
  if (root.version !== DEPLOY_IR_V2_VERSION) throw new Error('IR.version must be 2.');
  const name = nonEmptyString(root.name, 'IR.name');
  const auth = parseAuth(root.auth, 'IR.auth');
  const capabilities = normalizeCapabilities(
    array(root.capabilities, 'IR.capabilities').map((item, index) =>
      parseCapability(item, `IR.capabilities[${index}]`)
    )
  );
  const routes = array(root.routes, 'IR.routes').map((item, index) =>
    parseRoute(item, `IR.routes[${index}]`)
  );
  if (routes.length === 0) throw new Error('IR.routes must not be empty.');
  return {version: DEPLOY_IR_V2_VERSION, name, auth, capabilities, routes};
}

function withParseDiagnostic<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof DeployIrV2ParseError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    let code: DeployIrV2ParseErrorCode = 'TW2_IR_INVALID_VALUE';
    if (error instanceof SyntaxError) {
      code = message.startsWith('Duplicate object key:') ? 'TW2_IR_DUPLICATE_KEY' : 'TW2_IR_JSON_SYNTAX';
    } else if (message === 'IR.version must be 2.') {
      code = 'TW2_IR_VERSION';
    } else if (message.includes('contains unknown field:')) {
      code = 'TW2_IR_UNKNOWN_FIELD';
    } else if (message.includes('.kind is unsupported:')) {
      code = 'TW2_IR_UNKNOWN_NODE';
    }
    throw new DeployIrV2ParseError(code, message, error);
  }
}

function parseAuth(value: unknown, location: string): AuthPolicyV2 {
  const auth = object(value, location);
  const kind = nonEmptyString(auth.kind, `${location}.kind`);
  if (kind === 'none') {
    exactKeys(auth, ['kind'], location);
    return {kind};
  }
  if (kind === 'jwt') {
    exactKeys(auth, ['kind', 'scheme'], location);
    const scheme = nonEmptyString(auth.scheme, `${location}.scheme`);
    if (scheme !== 'external-jwt' && scheme !== 'trusted-access-jwt') {
      throw new Error(`${location}.scheme is unsupported: ${scheme}`);
    }
    return {kind, scheme};
  }
  throw new Error(`${location}.kind is unsupported: ${kind}`);
}

function parseCapability(value: unknown, location: string): CapabilityRequirementV2 {
  const capability = object(value, location);
  const kind = nonEmptyString(capability.kind, `${location}.kind`);
  if (kind === 'record-store') {
    exactKeys(capability, ['kind'], location);
    return {kind};
  }
  if (kind === 'request-metadata') {
    exactKeys(capability, ['kind', 'field'], location);
    if (capability.field !== 'client-address') throw new Error(`${location}.field is unsupported.`);
    return {kind, field: 'client-address'};
  }
  if (kind === 'auth') {
    exactKeys(capability, ['kind', 'scheme'], location);
    const scheme = capability.scheme;
    if (scheme !== 'external-jwt' && scheme !== 'trusted-access-jwt') {
      throw new Error(`${location}.scheme is unsupported.`);
    }
    return {kind, scheme};
  }
  throw new Error(`${location}.kind is unsupported: ${kind}`);
}

function parseRoute(value: unknown, location: string): RouteIrV2 {
  const route = object(value, location);
  exactKeys(route, ['id', 'method', 'path', 'auth', 'body', 'sourceRef'], location);
  const id = nonEmptyString(route.id, `${location}.id`);
  const method = nonEmptyString(route.method, `${location}.method`) as HttpMethodV2;
  if (!METHODS.has(method)) throw new Error(`${location}.method is unsupported: ${method}`);
  const path = nonEmptyString(route.path, `${location}.path`);
  const auth = route.auth;
  if (auth !== 'public' && auth !== 'required') throw new Error(`${location}.auth is invalid.`);
  const body = array(route.body, `${location}.body`).map((item, index) =>
    parseStatement(item, `${location}.body[${index}]`)
  );
  if (body.length === 0) throw new Error(`${location}.body must not be empty.`);
  const sourceRef = optionalSourceRef(route.sourceRef, `${location}.sourceRef`);
  return optional({id, method, path, auth, body}, 'sourceRef', sourceRef);
}

function parseStatement(value: unknown, location: string): StatementIrV2 {
  const statement = object(value, location);
  const kind = nonEmptyString(statement.kind, `${location}.kind`);
  const sourceRef = optionalSourceRef(statement.sourceRef, `${location}.sourceRef`);
  if (kind === 'set-status') {
    exactKeys(statement, ['kind', 'status', 'sourceRef'], location);
    const status = integer(statement.status, `${location}.status`);
    if (status < 100 || status > 599) throw new Error(`${location}.status must be from 100 to 599.`);
    return optional({kind, status}, 'sourceRef', sourceRef);
  }
  if (kind === 'set-header') {
    exactKeys(statement, ['kind', 'name', 'value', 'sourceRef'], location);
    return optional(
      {kind, name: nonEmptyString(statement.name, `${location}.name`), value: parseExpression(statement.value, `${location}.value`)},
      'sourceRef',
      sourceRef
    );
  }
  if (kind === 'remove-header') {
    exactKeys(statement, ['kind', 'name', 'sourceRef'], location);
    return optional({kind, name: nonEmptyString(statement.name, `${location}.name`)}, 'sourceRef', sourceRef);
  }
  if (kind === 'set-handler-variable' || kind === 'change-handler-variable') {
    exactKeys(statement, ['kind', 'name', 'value', 'sourceRef'], location);
    return optional(
      {
        kind,
        name: parseExpression(statement.name, `${location}.name`),
        value: parseExpression(statement.value, `${location}.value`)
      },
      'sourceRef',
      sourceRef
    );
  }
  if (kind === 'delete-handler-variable') {
    exactKeys(statement, ['kind', 'name', 'sourceRef'], location);
    return optional({kind, name: parseExpression(statement.name, `${location}.name`)}, 'sourceRef', sourceRef);
  }
  if (kind === 'clear-handler-variables') {
    exactKeys(statement, ['kind', 'sourceRef'], location);
    return optional({kind}, 'sourceRef', sourceRef);
  }
  if (kind === 'record-create') {
    exactKeys(statement, ['kind', 'collection', 'data', 'result', 'sourceRef'], location);
    return optional(
      {
        kind,
        collection: nonEmptyString(statement.collection, `${location}.collection`),
        data: parseExpression(statement.data, `${location}.data`),
        result: parseBinding(statement.result, `${location}.result`)
      },
      'sourceRef',
      sourceRef
    );
  }
  if (kind === 'record-list') {
    exactKeys(statement, ['kind', 'collection', 'result', 'sourceRef'], location);
    return optional(
      {
        kind,
        collection: nonEmptyString(statement.collection, `${location}.collection`),
        result: parseBinding(statement.result, `${location}.result`)
      },
      'sourceRef',
      sourceRef
    );
  }
  if (kind === 'record-get' || kind === 'record-delete') {
    exactKeys(statement, ['kind', 'id', 'result', 'sourceRef'], location);
    return optional(
      {kind, id: parseExpression(statement.id, `${location}.id`), result: parseBinding(statement.result, `${location}.result`)},
      'sourceRef',
      sourceRef
    );
  }
  if (kind === 'if') {
    exactKeys(statement, ['kind', 'condition', 'then', 'else', 'sourceRef'], location);
    const condition = parseExpression(statement.condition, `${location}.condition`);
    const then = parseStatements(statement.then, `${location}.then`);
    const otherwise = statement.else === undefined ? undefined : parseStatements(statement.else, `${location}.else`);
    return optional(optional({kind, condition, then}, 'else', otherwise), 'sourceRef', sourceRef);
  }
  if (kind === 'bounded-loop') {
    exactKeys(statement, ['kind', 'maxIterations', 'body', 'sourceRef'], location);
    const maxIterations = integer(statement.maxIterations, `${location}.maxIterations`);
    if (maxIterations < 0 || maxIterations > 1000) {
      throw new Error(`${location}.maxIterations must be from 0 to 1000.`);
    }
    return optional(
      {kind, maxIterations, body: parseStatements(statement.body, `${location}.body`)},
      'sourceRef',
      sourceRef
    );
  }
  if (kind === 'respond') {
    exactKeys(statement, ['kind', 'format', 'body', 'sourceRef'], location);
    const format = statement.format;
    if (format !== 'text' && format !== 'html' && format !== 'json') {
      throw new Error(`${location}.format is invalid.`);
    }
    return optional({kind, format, body: parseExpression(statement.body, `${location}.body`)}, 'sourceRef', sourceRef);
  }
  throw new Error(`${location}.kind is unsupported: ${kind}`);
}

function parseStatements(value: unknown, location: string): StatementIrV2[] {
  return array(value, location).map((item, index) => parseStatement(item, `${location}[${index}]`));
}

function parseExpression(value: unknown, location: string): ExpressionIrV2 {
  const expression = object(value, location);
  const kind = nonEmptyString(expression.kind, `${location}.kind`);
  const sourceRef = optionalSourceRef(expression.sourceRef, `${location}.sourceRef`);
  if (kind === 'literal') {
    exactKeys(expression, ['kind', 'valueType', 'value', 'sourceRef'], location);
    const valueType = atomicType(expression.valueType, `${location}.valueType`);
    if (valueType === 'binary-ref') {
      const binaryRef = parseBinaryRef(expression.value, `${location}.value`);
      return optional({kind, valueType, value: binaryRef}, 'sourceRef', sourceRef);
    }
    const literal = jsonValue(expression.value, `${location}.value`);
    assertLiteralType(valueType, literal, location);
    return optional({kind, valueType, value: literal}, 'sourceRef', sourceRef);
  }
  if (kind === 'request') {
    exactKeys(expression, ['kind', 'valueType', 'source', 'sourceRef'], location);
    if (expression.valueType !== 'string') throw new Error(`${location}.valueType must be string.`);
    const source = expression.source;
    if (!['method', 'path', 'url', 'body-text', 'content-type', 'client-address'].includes(String(source))) {
      throw new Error(`${location}.source is unsupported.`);
    }
    return optional(
      {kind, valueType: 'string', source: source as Extract<ExpressionIrV2, {kind: 'request'}>['source']},
      'sourceRef',
      sourceRef
    );
  }
  if (kind === 'request-value') {
    exactKeys(expression, ['kind', 'valueType', 'source', 'name', 'sourceRef'], location);
    if (expression.valueType !== 'string') throw new Error(`${location}.valueType must be string.`);
    const source = expression.source;
    if (source !== 'query' && source !== 'path-param' && source !== 'header') {
      throw new Error(`${location}.source is unsupported.`);
    }
    return optional(
      {kind, valueType: 'string', source, name: nonEmptyString(expression.name, `${location}.name`)},
      'sourceRef',
      sourceRef
    );
  }
  if (kind === 'concat') {
    exactKeys(expression, ['kind', 'valueType', 'left', 'right', 'sourceRef'], location);
    if (expression.valueType !== 'string') throw new Error(`${location}.valueType must be string.`);
    return optional(
      {
        kind,
        valueType: 'string',
        left: parseExpression(expression.left, `${location}.left`),
        right: parseExpression(expression.right, `${location}.right`)
      },
      'sourceRef',
      sourceRef
    );
  }
  if (kind === 'handler-variable') {
    exactKeys(expression, ['kind', 'valueType', 'name', 'sourceRef'], location);
    const valueType = parseValueType(expression.valueType, `${location}.valueType`);
    if (!isStringNumberUnion(valueType)) throw new Error(`${location}.valueType must be the number|string union.`);
    return optional(
      {kind, valueType: {kind: 'union', members: ['number', 'string']}, name: parseExpression(expression.name, `${location}.name`)},
      'sourceRef',
      sourceRef
    );
  }
  if (kind === 'handler-variable-exists') {
    exactKeys(expression, ['kind', 'valueType', 'name', 'sourceRef'], location);
    if (expression.valueType !== 'boolean') throw new Error(`${location}.valueType must be boolean.`);
    return optional(
      {kind, valueType: 'boolean', name: parseExpression(expression.name, `${location}.name`)},
      'sourceRef',
      sourceRef
    );
  }
  if (kind === 'handler-variable-names') {
    exactKeys(expression, ['kind', 'valueType', 'sourceRef'], location);
    if (expression.valueType !== 'string') throw new Error(`${location}.valueType must be string.`);
    return optional({kind, valueType: 'string'}, 'sourceRef', sourceRef);
  }
  if (kind === 'binding') {
    exactKeys(expression, ['kind', 'valueType', 'binding', 'sourceRef'], location);
    return optional(
      {
        kind,
        valueType: parseValueType(expression.valueType, `${location}.valueType`),
        binding: bindingId(expression.binding, `${location}.binding`)
      },
      'sourceRef',
      sourceRef
    );
  }
  throw new Error(`${location}.kind is unsupported: ${kind}`);
}

function parseBinding(value: unknown, location: string): BindingDeclarationV2 {
  const binding = object(value, location);
  exactKeys(binding, ['id', 'type'], location);
  return {id: bindingId(binding.id, `${location}.id`), type: parseBindingType(binding.type, `${location}.type`)};
}

function parseBindingType(value: unknown, location: string): BindingTypeV2 {
  const type = object(value, location);
  const kind = nonEmptyString(type.kind, `${location}.kind`);
  if (kind === 'value') {
    exactKeys(type, ['kind', 'valueType'], location);
    return {kind, valueType: parseValueType(type.valueType, `${location}.valueType`)};
  }
  if (kind === 'resource') {
    exactKeys(type, ['kind', 'resourceType'], location);
    if (type.resourceType !== 'binary-body') throw new Error(`${location}.resourceType is unsupported.`);
    return {kind, resourceType: 'binary-body'};
  }
  throw new Error(`${location}.kind is unsupported: ${kind}`);
}

function parseValueType(value: unknown, location: string): ValueTypeV2 {
  if (typeof value === 'string') return atomicType(value, location);
  const type = object(value, location);
  exactKeys(type, ['kind', 'members'], location);
  if (type.kind !== 'union') throw new Error(`${location}.kind must be union.`);
  const members = array(type.members, `${location}.members`).map((member, index) =>
    atomicType(member, `${location}.members[${index}]`)
  );
  if (members.length < 2 || new Set(members).size !== members.length) {
    throw new Error(`${location}.members must contain at least two unique atomic types.`);
  }
  return {
    kind: 'union',
    members: members.sort((left, right) => ATOMIC_TYPE_ORDER.indexOf(left) - ATOMIC_TYPE_ORDER.indexOf(right))
  };
}

function normalizeCapabilities(capabilities: CapabilityRequirementV2[]): CapabilityRequirementV2[] {
  const entries = capabilities.map((capability) => [JSON.stringify(capability), capability] as const);
  if (new Set(entries.map(([key]) => key)).size !== entries.length) {
    throw new Error('IR.capabilities must not contain duplicates.');
  }
  return entries
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, capability]) => capability);
}

function optionalSourceRef(value: unknown, location: string): SourceRefV2 | undefined {
  if (value === undefined) return undefined;
  const source = object(value, location);
  exactKeys(source, ['targetIndex', 'targetName', 'blockId', 'opcode', 'input'], location);
  const result = {
    targetIndex: integer(source.targetIndex, `${location}.targetIndex`),
    targetName: nonEmptyString(source.targetName, `${location}.targetName`),
    blockId: nonEmptyString(source.blockId, `${location}.blockId`),
    opcode: nonEmptyString(source.opcode, `${location}.opcode`)
  };
  if (result.targetIndex < 0) throw new Error(`${location}.targetIndex must not be negative.`);
  const input = source.input === undefined ? undefined : nonEmptyString(source.input, `${location}.input`);
  return optional(result, 'input', input);
}

function jsonValue(value: unknown, location: string): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${location} must be a finite JSON number.`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${location}[${index}]`));
  const record = object(value, location);
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, jsonValue(item, `${location}.${key}`)]));
}

function parseBinaryRef(value: unknown, location: string): BinaryRefDescriptorV2 {
  const descriptor = object(value, location);
  exactKeys(descriptor, ['namespace', 'key', 'mediaType', 'byteLength', 'sha256'], location);
  const namespace = nonEmptyString(descriptor.namespace, `${location}.namespace`);
  if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(namespace)) {
    throw new Error(`${location}.namespace must be a logical namespace identifier.`);
  }
  const key = nonEmptyString(descriptor.key, `${location}.key`);
  const mediaType = optionalString(descriptor.mediaType, `${location}.mediaType`);
  const byteLength =
    descriptor.byteLength === undefined ? undefined : integer(descriptor.byteLength, `${location}.byteLength`);
  if (byteLength !== undefined && byteLength < 0) throw new Error(`${location}.byteLength must not be negative.`);
  const sha256 = optionalString(descriptor.sha256, `${location}.sha256`);
  if (sha256 !== undefined && !/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error(`${location}.sha256 must be 64 lowercase hexadecimal characters.`);
  }
  return optional(
    optional(optional({namespace, key}, 'mediaType', mediaType), 'byteLength', byteLength),
    'sha256',
    sha256
  );
}

function assertLiteralType(type: Exclude<AtomicValueTypeV2, 'binary-ref'>, value: JsonValue, location: string): void {
  const actual = value === null ? 'null' : Array.isArray(value) ? 'json-array' : typeof value === 'object' ? 'json-object' : typeof value;
  if (type !== actual) throw new Error(`${location}.valueType ${type} does not match ${actual}.`);
}

function isStringNumberUnion(type: ValueTypeV2): type is {kind: 'union'; members: ['number', 'string']} {
  return typeof type !== 'string' && type.members.length === 2 && type.members[0] === 'number' && type.members[1] === 'string';
}

function atomicType(value: unknown, location: string): AtomicValueTypeV2 {
  if (typeof value !== 'string' || !ATOMIC_TYPES.has(value as AtomicValueTypeV2)) {
    throw new Error(`${location} is not an atomic IR value type.`);
  }
  return value as AtomicValueTypeV2;
}

function bindingId(value: unknown, location: string): string {
  const id = nonEmptyString(value, location);
  if (!BINDING_ID.test(id)) throw new Error(`${location} is not a valid binding ID.`);
  return id;
}

function object(value: unknown, location: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${location} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, location: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${location} must be an array.`);
  return value;
}

function nonEmptyString(value: unknown, location: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${location} must be a non-empty string.`);
  return value;
}

function optionalString(value: unknown, location: string): string | undefined {
  return value === undefined ? undefined : nonEmptyString(value, location);
}

function integer(value: unknown, location: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${location} must be a safe integer.`);
  return value;
}

function exactKeys(record: Record<string, unknown>, allowed: readonly string[], location: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(record).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) throw new Error(`${location} contains unknown field: ${unknown.sort()[0]}`);
}

function optional<T extends object, K extends string, V>(base: T, key: K, value: V | undefined): T & Partial<Record<K, V>> {
  return value === undefined ? base : {...base, [key]: value};
}
