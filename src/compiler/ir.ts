export const DEPLOY_IR_VERSION = 1 as const;

export type HttpMethod = 'ALL' | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';
export type AuthMode = 'none' | 'cloudflare-access' | 'external-jwt';
export type ResponseFormat = 'text' | 'html' | 'json';

export interface DeployIr {
  version: typeof DEPLOY_IR_VERSION;
  name: string;
  auth: AuthMode;
  routes: RouteIr[];
}

export interface RouteIr {
  id: string;
  method: HttpMethod;
  path: string;
  auth: 'public' | 'required';
  actions: ActionIr[];
}

export type ExpressionIr =
  | {kind: 'literal'; value: string}
  | {
      kind: 'request';
      source: 'method' | 'path' | 'url' | 'body' | 'content-type' | 'client-address';
    }
  | {kind: 'request-value'; source: 'query' | 'path-param' | 'header'; name: string}
  | {kind: 'concat'; left: ExpressionIr; right: ExpressionIr}
  | {kind: 'handler-variable'; name: ExpressionIr}
  | {kind: 'handler-variable-exists'; name: ExpressionIr}
  | {kind: 'handler-variable-names'}
  | {kind: 'result'; name: string};

export type ActionIr =
  | {kind: 'set-status'; status: number}
  | {kind: 'set-header'; name: string; value: ExpressionIr}
  | {kind: 'remove-header'; name: string}
  | {kind: 'set-handler-variable'; name: ExpressionIr; value: ExpressionIr}
  | {kind: 'change-handler-variable'; name: ExpressionIr; value: ExpressionIr}
  | {kind: 'delete-handler-variable'; name: ExpressionIr}
  | {kind: 'clear-handler-variables'}
  | {kind: 'respond'; format: ResponseFormat; body: ExpressionIr}
  | {
      kind: 'record-create';
      collection: string;
      data: ExpressionIr;
      result: string;
    }
  | {kind: 'record-list'; collection: string; result: string}
  | {kind: 'record-get'; id: ExpressionIr; result: string}
  | {kind: 'record-delete'; id: ExpressionIr; result: string};

export interface CompilerDiagnostic {
  severity: 'warning' | 'error';
  code: string;
  message: string;
  target?: string;
  blockId?: string;
}

export interface CompileResult {
  ir: DeployIr;
  diagnostics: CompilerDiagnostic[];
}
