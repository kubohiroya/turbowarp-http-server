export const HTTP_BRIDGE_PROTOCOL = 'turbowarp-http-server' as const;
export const HTTP_BRIDGE_PROTOCOL_VERSION = 1 as const;

export interface BridgeTextBody {
  kind: 'text';
  text: string;
}

export interface BridgeEmptyBody {
  kind: 'empty';
}

export interface BridgeUnsupportedBody {
  kind: 'unsupported';
  reason: string;
}

export interface BridgeNamedBody {
  kind: 'named';
  reference: {
    namespace: string;
    name: string;
    kind: 'structured' | 'document' | 'binary' | 'asset';
    scope: 'target' | 'project';
  };
  representation: 'json' | 'yaml' | 'html' | 'markdown' | 'raw';
  targetId?: string;
  maxBytes: number;
}

export type BridgeBody = BridgeTextBody | BridgeEmptyBody | BridgeUnsupportedBody | BridgeNamedBody;

export interface BridgeRequestMessage {
  type: 'request';
  protocol: typeof HTTP_BRIDGE_PROTOCOL;
  version: typeof HTTP_BRIDGE_PROTOCOL_VERSION;
  id: string;
  method: string;
  url: string;
  path: string;
  route: string;
  pathParams: Record<string, string>;
  query: Record<string, string[]>;
  headers: Record<string, string[]>;
  body: BridgeBody;
  clientAddress: string;
}

export interface BridgeResponseMessage {
  type: 'response';
  id: string;
  status: number;
  headers: Record<string, string[]>;
  body: BridgeBody;
}

export interface BridgeErrorMessage {
  type: 'error';
  id?: string;
  message: string;
}

export type BridgeClientMessage = BridgeResponseMessage | BridgeErrorMessage;

export function normalizeHeaderName(name: string): string {
  return name.trim().toLowerCase();
}

export function isValidHttpStatus(status: number): boolean {
  return Number.isInteger(status) && status >= 100 && status <= 599;
}

export function isBodyForbidden(method: string, status: number): boolean {
  return method.toUpperCase() === 'HEAD' || status === 204 || status === 205 || status === 304;
}

export function isForbiddenResponseHeader(name: string): boolean {
  return ['connection', 'content-length', 'transfer-encoding', 'upgrade'].includes(
    normalizeHeaderName(name)
  );
}

export function validateHeaderName(name: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name);
}

export function validateHeaderValue(value: string): boolean {
  return !/[\r\n]/.test(value);
}

export function firstValue(values: readonly string[] | undefined): string {
  return values?.[0] ?? '';
}

export function parseBridgeClientMessage(value: string): BridgeClientMessage | null {
  try {
    const parsed = JSON.parse(value) as Partial<BridgeClientMessage>;
    if (parsed.type === 'response' && typeof parsed.id === 'string') {
      return {
        type: 'response',
        id: parsed.id,
        status: typeof parsed.status === 'number' ? parsed.status : 200,
        headers: requireHeaderRecord(parsed.headers),
        body: requireBridgeBody(parsed.body)
      };
    }
    if (parsed.type === 'error') {
      const error: BridgeErrorMessage = {
        type: 'error',
        message: typeof parsed.message === 'string' ? parsed.message : 'Bridge error.'
      };
      if (typeof parsed.id === 'string') error.id = parsed.id;
      return error;
    }
  } catch {
    return null;
  }
  return null;
}

export function requireHeaderRecord(value: unknown): Record<string, string[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const result: Record<string, string[]> = {};
  for (const [name, rawValues] of Object.entries(value)) {
    const values = Array.isArray(rawValues) ? rawValues : [rawValues];
    result[name] = values.map((item) => String(item));
  }
  return result;
}

export function requireBridgeBody(value: unknown): BridgeBody {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {kind: 'empty'};
  const record = value as Record<string, unknown>;
  if (record.kind === 'text') return {kind: 'text', text: String(record.text ?? '')};
  if (record.kind === 'named') return requireNamedBridgeBody(record);
  if (record.kind === 'unsupported') return {kind: 'unsupported', reason: String(record.reason ?? '')};
  return {kind: 'empty'};
}

function requireNamedBridgeBody(record: Record<string, unknown>): BridgeBody {
  const reference = record.reference;
  if (typeof reference !== 'object' || reference === null || Array.isArray(reference)) {
    return {kind: 'unsupported', reason: 'invalid_named_body'};
  }
  const value = reference as Record<string, unknown>;
  const kinds = ['structured', 'document', 'binary', 'asset'] as const;
  const scopes = ['target', 'project'] as const;
  const representations = ['json', 'yaml', 'html', 'markdown', 'raw'] as const;
  if (
    typeof value.namespace !== 'string' ||
    typeof value.name !== 'string' ||
    !kinds.includes(value.kind as (typeof kinds)[number]) ||
    !scopes.includes(value.scope as (typeof scopes)[number]) ||
    !representations.includes(record.representation as (typeof representations)[number]) ||
    !Number.isSafeInteger(record.maxBytes) ||
    (record.maxBytes as number) < 1 ||
    (record.targetId !== undefined && typeof record.targetId !== 'string')
  ) {
    return {kind: 'unsupported', reason: 'invalid_named_body'};
  }
  return {
    kind: 'named',
    reference: {
      namespace: value.namespace,
      name: value.name,
      kind: value.kind as (typeof kinds)[number],
      scope: value.scope as (typeof scopes)[number]
    },
    representation: record.representation as (typeof representations)[number],
    ...(record.targetId === undefined ? {} : {targetId: record.targetId}),
    maxBytes: record.maxBytes as number
  };
}
