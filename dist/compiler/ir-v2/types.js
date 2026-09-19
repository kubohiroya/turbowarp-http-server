export const DEPLOY_IR_V2_VERSION = 2;
export const IR_V2_EXPRESSION_KINDS = [
    'literal',
    'request',
    'request-value',
    'concat',
    'handler-variable',
    'handler-variable-exists',
    'handler-variable-names',
    'binding'
];
export const IR_V2_STATEMENT_KINDS = [
    'set-status',
    'set-header',
    'remove-header',
    'set-handler-variable',
    'change-handler-variable',
    'delete-handler-variable',
    'clear-handler-variables',
    'record-create',
    'record-list',
    'record-get',
    'record-delete',
    'if',
    'bounded-loop',
    'respond'
];
export const IR_V2_STATEMENT_EFFECTS = {
    'set-status': ['response-write'],
    'set-header': ['response-write'],
    'remove-header': ['response-write'],
    'set-handler-variable': ['handler-state-write'],
    'change-handler-variable': ['handler-state-write'],
    'delete-handler-variable': ['handler-state-write'],
    'clear-handler-variables': ['handler-state-write'],
    'record-create': ['record-write'],
    'record-list': ['record-read'],
    'record-get': ['record-read'],
    'record-delete': ['record-write'],
    if: ['control'],
    'bounded-loop': ['control'],
    respond: ['response-write']
};
//# sourceMappingURL=types.js.map