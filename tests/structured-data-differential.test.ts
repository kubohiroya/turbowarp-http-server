import {describe, expect, it} from 'vitest';
import {
  HTTP,
  SD,
  block,
  browserOutcome,
  browserUtility,
  createBrowserStructuredData,
  query,
  reporter,
  requestBody,
  respondText,
  runProject,
  type BrowserStructuredData,
  type InputSpec,
  type ServerOutcome,
  type StatementSpec
} from './structured-data-support.js';

/**
 * Runs the same block sequence on the published browser extension and on the server pipeline and
 * requires the same result or the same first error code. Inputs that the server would reject while
 * compiling are read from the request instead (`{query}` or `{body}`), so these cases compare runtime
 * behaviour. Browser error orders cited below are in turbowarp-structured-data src/extension.ts at
 * 6bbb908.
 */

type Arg = string | {query: string} | {body: true};
type Step =
  | {op: 'parseJson'; name: Arg; text: Arg}
  | {op: 'set'; name: Arg; path: string; value: Arg}
  | {op: 'delete'; name: Arg; path: string}
  | {op: 'deleteData'; name: Arg};
type Read =
  | {op: 'get' | 'getText' | 'has' | 'keys' | 'length'; name: Arg; path: string}
  | {op: 'hasData' | 'toJson'; name: Arg};

interface Scenario {
  label: string;
  steps: Step[];
  read: Read;
  query?: Record<string, string>;
  body?: string;
  expected: ServerOutcome;
}

const NAME = {query: 'name'} as const;
const BODY = {body: true} as const;
const doc = '{"list":[1,2,3],"object":{"b":2,"a":1},"text":"t","none":null}';
const deep = (levels: number) => `${'['.repeat(levels)}${']'.repeat(levels)}`;
const LIMIT = 262144;

const scenarios: Scenario[] = [
  // parseJson (extension.ts:252-259): TEXT is decoded before store() checks NAME.
  {label: 'parse: invalid TEXT beats a blank NAME', steps: [{op: 'parseJson', name: NAME, text: BODY}], read: {op: 'hasData', name: 'x'}, query: {name: ' '}, body: '{', expected: {error: 'INVALID_JSON'}},
  {label: 'parse: oversize TEXT beats a blank NAME', steps: [{op: 'parseJson', name: NAME, text: BODY}], read: {op: 'hasData', name: 'x'}, query: {name: ' '}, body: `{${' '.repeat(LIMIT)}`, expected: {error: 'PARSE_LIMIT_EXCEEDED'}},
  {label: 'parse: too-deep TEXT beats a blank NAME', steps: [{op: 'parseJson', name: NAME, text: BODY}], read: {op: 'hasData', name: 'x'}, query: {name: ' '}, body: deep(66), expected: {error: 'PARSE_LIMIT_EXCEEDED'}},
  {label: 'parse: a valid TEXT with a blank NAME', steps: [{op: 'parseJson', name: NAME, text: BODY}], read: {op: 'hasData', name: 'x'}, query: {name: ' \t'}, body: '[]', expected: {error: 'INVALID_NAME'}},
  {label: 'parse: names are trimmed', steps: [{op: 'parseJson', name: NAME, text: BODY}], read: {op: 'toJson', name: 'doc'}, query: {name: ' doc\n'}, body: '{"b":1,"a":[true]}', expected: {value: '{"a":[true],"b":1}'}},
  {label: 'parse: a second parse replaces the value', steps: [{op: 'parseJson', name: 'doc', text: '[1]'}, {op: 'parseJson', name: 'doc', text: BODY}], read: {op: 'toJson', name: 'doc'}, body: '{"x":"y"}', expected: {value: '{"x":"y"}'}},
  // set (extension.ts:329-341): NAME, then the binding, then VALUE, then the path update.
  {label: 'set: a blank NAME comes first', steps: [{op: 'set', name: NAME, path: '$.a', value: BODY}], read: {op: 'hasData', name: 'x'}, query: {name: ''}, body: '{', expected: {error: 'INVALID_NAME'}},
  {label: 'set: missing data beats an invalid VALUE', steps: [{op: 'set', name: NAME, path: '$.a', value: BODY}], read: {op: 'hasData', name: 'x'}, query: {name: 'missing'}, body: '{', expected: {error: 'DATA_NOT_FOUND'}},
  {label: 'set: an invalid VALUE beats a path error', steps: [{op: 'parseJson', name: 'doc', text: doc}, {op: 'set', name: 'doc', path: '$.text.inner', value: BODY}], read: {op: 'toJson', name: 'doc'}, body: '{', expected: {error: 'INVALID_JSON'}},
  {label: 'set: through a scalar', steps: [{op: 'parseJson', name: 'doc', text: doc}, {op: 'set', name: 'doc', path: '$.text.inner', value: BODY}], read: {op: 'toJson', name: 'doc'}, body: '1', expected: {error: 'TYPE_MISMATCH'}},
  {label: 'set: no append past the end', steps: [{op: 'parseJson', name: 'doc', text: doc}, {op: 'set', name: 'doc', path: '$.list[3]', value: BODY}], read: {op: 'toJson', name: 'doc'}, body: '4', expected: {error: 'INDEX_OUT_OF_RANGE'}},
  {label: 'set: no intermediate containers', steps: [{op: 'parseJson', name: 'doc', text: doc}, {op: 'set', name: 'doc', path: '$.missing.key', value: BODY}], read: {op: 'toJson', name: 'doc'}, body: '4', expected: {error: 'PATH_NOT_FOUND'}},
  {label: 'set: replaces the root and adds keys', steps: [{op: 'parseJson', name: 'doc', text: doc}, {op: 'set', name: 'doc', path: '$', value: BODY}, {op: 'set', name: 'doc', path: '$.added', value: 'null'}], read: {op: 'toJson', name: 'doc'}, body: '{"z":[]}', expected: {value: '{"added":null,"z":[]}'}},
  {label: 'set: VALUE has no codec depth limit', steps: [{op: 'parseJson', name: 'doc', text: doc}, {op: 'set', name: 'doc', path: '$.text', value: BODY}], read: {op: 'length', name: 'doc', path: '$.text'}, body: deep(100), expected: {value: '1'}},
  {label: 'set: a failed update keeps the old value', steps: [{op: 'parseJson', name: 'doc', text: doc}, {op: 'set', name: 'doc', path: '$.list[9]', value: '0'}], read: {op: 'toJson', name: 'doc'}, expected: {error: 'INDEX_OUT_OF_RANGE'}},
  // delete (extension.ts:343-351) and deleteData (extension.ts:307-311).
  {label: 'delete: missing data', steps: [{op: 'delete', name: NAME, path: '$.a'}], read: {op: 'hasData', name: 'x'}, query: {name: 'missing'}, expected: {error: 'DATA_NOT_FOUND'}},
  {label: 'delete: a missing key', steps: [{op: 'parseJson', name: 'doc', text: doc}, {op: 'delete', name: 'doc', path: '$.object.c'}], read: {op: 'toJson', name: 'doc'}, expected: {error: 'PATH_NOT_FOUND'}},
  {label: 'delete: array items shift left', steps: [{op: 'parseJson', name: 'doc', text: doc}, {op: 'delete', name: 'doc', path: '$.list[0]'}], read: {op: 'get', name: 'doc', path: '$.list'}, expected: {value: '[2,3]'}},
  {label: 'deleteData: a blank NAME', steps: [{op: 'deleteData', name: NAME}], read: {op: 'hasData', name: 'x'}, query: {name: '  '}, expected: {error: 'INVALID_NAME'}},
  {label: 'deleteData: missing data', steps: [{op: 'deleteData', name: NAME}], read: {op: 'hasData', name: 'x'}, query: {name: 'missing'}, expected: {error: 'DATA_NOT_FOUND'}},
  {label: 'deleteData: removes the binding', steps: [{op: 'parseJson', name: 'doc', text: doc}, {op: 'deleteData', name: NAME}], read: {op: 'hasData', name: 'doc'}, query: {name: 'doc '}, expected: {value: 'false'}},
  // hasData (extension.ts:303-305) checks the name; the readers go through requireData.
  {label: 'hasData: a blank NAME', steps: [], read: {op: 'hasData', name: NAME}, query: {name: ''}, expected: {error: 'INVALID_NAME'}},
  {label: 'hasData: missing data is false', steps: [], read: {op: 'hasData', name: NAME}, query: {name: 'missing'}, expected: {value: 'false'}},
  {label: 'get: missing data', steps: [], read: {op: 'get', name: NAME, path: '$'}, query: {name: 'missing'}, expected: {error: 'DATA_NOT_FOUND'}},
  {label: 'toJson: a blank NAME', steps: [], read: {op: 'toJson', name: NAME}, query: {name: '\n'}, expected: {error: 'INVALID_NAME'}},
  {label: 'has: false only when the path is missing', steps: [{op: 'parseJson', name: 'doc', text: doc}], read: {op: 'has', name: 'doc', path: '$.list[7]'}, expected: {value: 'false'}},
  {label: 'has: a type mismatch still fails', steps: [{op: 'parseJson', name: 'doc', text: doc}], read: {op: 'has', name: 'doc', path: '$.text.x'}, expected: {error: 'TYPE_MISMATCH'}},
  {label: 'keys: code point order', steps: [{op: 'parseJson', name: 'doc', text: BODY}], read: {op: 'keys', name: 'doc', path: '$'}, body: '{"😀":0,"z":0,"A":0,"é":0,"10":0,"2":0}', expected: {value: '["10","2","A","z","é","😀"]'}},
  {label: 'keys: arrays are a type mismatch', steps: [{op: 'parseJson', name: 'doc', text: doc}], read: {op: 'keys', name: 'doc', path: '$.list'}, expected: {error: 'TYPE_MISMATCH'}},
  {label: 'length: objects are a type mismatch', steps: [{op: 'parseJson', name: 'doc', text: doc}], read: {op: 'length', name: 'doc', path: '$.object'}, expected: {error: 'TYPE_MISMATCH'}},
  {label: 'getText: null is a type mismatch', steps: [{op: 'parseJson', name: 'doc', text: doc}], read: {op: 'getText', name: 'doc', path: '$.none'}, expected: {error: 'TYPE_MISMATCH'}},
  // Codec limits and JSON syntax.
  {label: 'limit: 65 nested arrays fit', steps: [{op: 'parseJson', name: 'doc', text: BODY}], read: {op: 'hasData', name: 'doc'}, body: deep(65), expected: {value: 'true'}},
  {label: 'limit: 50,000 values fit', steps: [{op: 'parseJson', name: 'doc', text: BODY}], read: {op: 'length', name: 'doc', path: '$'}, body: `[${Array(49999).fill('0').join(',')}]`, expected: {value: '49999'}},
  {label: 'limit: 50,001 values do not', steps: [{op: 'parseJson', name: 'doc', text: BODY}], read: {op: 'hasData', name: 'doc'}, body: `[${Array(50000).fill('0').join(',')}]`, expected: {error: 'PARSE_LIMIT_EXCEEDED'}},
  {label: 'limit: object keys are not values', steps: [{op: 'parseJson', name: 'doc', text: BODY}], read: {op: 'length', name: 'doc', path: '$'}, body: `[${Array(16666).fill('{"a":0,"b":0}').join(',')}]`, expected: {value: '16666'}},
  {label: 'limit: exactly 256 KiB of UTF-8 fits', steps: [{op: 'parseJson', name: 'doc', text: BODY}], read: {op: 'hasData', name: 'doc'}, body: `"${'あ'.repeat(87380)}aa"`, expected: {value: 'true'}},
  {label: 'limit: one byte more does not', steps: [{op: 'parseJson', name: 'doc', text: BODY}], read: {op: 'hasData', name: 'doc'}, body: `"${'あ'.repeat(87380)}aaa"`, expected: {error: 'PARSE_LIMIT_EXCEEDED'}},
  {label: 'limit: a non-finite number met first', steps: [{op: 'parseJson', name: 'doc', text: BODY}], read: {op: 'hasData', name: 'doc'}, body: `{"b":1e999,"a":${deep(70)}}`, expected: {error: 'INVALID_JSON'}},
  {label: 'limit: depth met first through an integer key', steps: [{op: 'parseJson', name: 'doc', text: BODY}], read: {op: 'hasData', name: 'doc'}, body: `{"b":1e999,"1":${deep(70)}}`, expected: {error: 'PARSE_LIMIT_EXCEEDED'}},
  // These read TEXT from the query: a request body's leading BOM is removed when the body is decoded.
  ...['', ' ', '[1,]', '01', '\u00a01', '\ufeff1', '// c\n1', '{"a" 1}', 'tru'].map(
    (text): Scenario => ({label: `syntax: ${JSON.stringify(text)} is invalid`, steps: [{op: 'parseJson', name: 'doc', text: {query: 'text'}}], read: {op: 'hasData', name: 'doc'}, query: {text}, expected: {error: 'INVALID_JSON'}})
  ),
  {label: 'syntax: U+2028 inside a string', steps: [{op: 'parseJson', name: 'doc', text: BODY}], read: {op: 'getText', name: 'doc', path: '$'}, body: '"a\u2028b"', expected: {value: 'a\u2028b'}},
  {label: 'syntax: the last duplicate key wins', steps: [{op: 'parseJson', name: 'doc', text: BODY}], read: {op: 'toJson', name: 'doc'}, body: '{"a":1,"a":2}', expected: {value: '{"a":2}'}},
  {label: 'syntax: "__proto__" stays a key', steps: [{op: 'parseJson', name: 'doc', text: BODY}], read: {op: 'toJson', name: 'doc'}, body: '{"__proto__":{"x":1}}', expected: {value: '{"__proto__":{"x":1}}'}},
  {label: 'syntax: numbers keep their JSON text', steps: [{op: 'parseJson', name: 'doc', text: BODY}], read: {op: 'toJson', name: 'doc'}, body: '[-0,1e21,0.1,1E-7,5e-324,1.50]', expected: {value: '[0,1e+21,0.1,1e-7,5e-324,1.5]'}}
];

describe('Structured Data against the published browser extension', () => {
  it.each(scenarios.map((scenario) => [scenario.label, scenario] as const))('%s', async (_label, scenario) => {
    const browser = runBrowser(await createBrowserStructuredData(), scenario);
    expect(browser, 'browser').toEqual(scenario.expected);
    const server = await runProject(serverStatements(scenario), {
      ...(scenario.query === undefined ? {} : {query: scenario.query}),
      ...(scenario.body === undefined ? {} : {body: scenario.body})
    });
    expect(server, 'server').toEqual(browser);
  });

  it('iterates the value as it was when the loop started, like the browser', async () => {
    // Every pass deletes the first item and records the entry it is on. The browser copies the
    // entries out before the first pass (extension.ts:363-397); json-for-each evaluates its root once.
    const text = '{"items":["a","b","c"]}';
    const extension = await createBrowserStructuredData();
    const target = {};
    const thread = {};
    extension.parseJson({TEXT: text, NAME: 'doc'}, browserUtility(target, thread));
    let seen = '';
    const frame = {...browserUtility(target, thread), started: 0};
    frame.startBranch = () => {
      frame.started += 1;
    };
    for (let pass = 0; pass < 10; pass += 1) {
      const before = frame.started;
      extension.forEachAtPath({NAME: 'doc', PATH: '$.items', MAX: 5}, frame);
      if (frame.started === before) break;
      const body = browserUtility(target, thread);
      seen += `${extension.currentKey({}, body)}=${extension.currentTextAtPath({PATH: '$'}, body)};`;
      extension.deleteAtPath({NAME: 'doc', PATH: '$.items[0]'}, body);
    }
    const browser = `${seen}|${extension.toJson({NAME: 'doc'}, browserUtility(target, thread))}`;
    expect(browser).toBe('0=a;1=b;2=c;|{"items":[]}');

    // The validator rejects join with a handler variable operand, so each pass records itself as a
    // handler variable name, and the names come back in insertion order.
    const entryText = reporter('operator_join', {
      STRING1: reporter(`${SD}currentKey`),
      STRING2: reporter('operator_join', {STRING1: '=', STRING2: reporter(`${SD}currentTextAtPath`, {PATH: '$'})})
    });
    const server = await runProject([
      block(`${SD}parseJson`, {NAME: 'doc', TEXT: text}),
      block(`${SD}forEachAtPath`, {NAME: 'doc', PATH: '$.items', MAX: 5}, [
        block(`${HTTP}setHandlerVariable`, {NAME: entryText, VALUE: '1'}),
        block(`${SD}deleteAtPath`, {NAME: 'doc', PATH: '$.items[0]'})
      ]),
      block(`${HTTP}setHandlerVariable`, {NAME: reporter(`${SD}toJson`, {NAME: 'doc'}), VALUE: '1'}),
      respondText(reporter(`${HTTP}listHandlerVariables`))
    ]);
    expect(server).toEqual({value: '0=a,1=b,2=c,{"items":[]}'});
  });
});

function resolveBrowser(arg: Arg, scenario: Scenario): string {
  if (typeof arg === 'string') return arg;
  if ('query' in arg) return scenario.query?.[arg.query] ?? '';
  return scenario.body ?? '';
}

function resolveServer(arg: Arg): InputSpec {
  if (typeof arg === 'string') return arg;
  return 'query' in arg ? query(arg.query) : requestBody;
}

function runBrowser(extension: BrowserStructuredData, scenario: Scenario): ServerOutcome {
  const util = browserUtility();
  const value = (arg: Arg) => resolveBrowser(arg, scenario);
  return browserOutcome(() => {
    for (const step of scenario.steps) {
      if (step.op === 'parseJson') extension.parseJson({TEXT: value(step.text), NAME: value(step.name)}, util);
      else if (step.op === 'set') extension.setJsonAtPath({NAME: value(step.name), PATH: step.path, VALUE: value(step.value)}, util);
      else if (step.op === 'delete') extension.deleteAtPath({NAME: value(step.name), PATH: step.path}, util);
      else extension.deleteStructuredData({NAME: value(step.name)}, util);
    }
    const read = scenario.read;
    const NAME_VALUE = value(read.name);
    switch (read.op) {
      case 'hasData':
        return extension.hasStructuredData({NAME: NAME_VALUE}, util);
      case 'toJson':
        return extension.toJson({NAME: NAME_VALUE}, util);
      case 'get':
        return extension.getJsonAtPath({NAME: NAME_VALUE, PATH: read.path}, util);
      case 'getText':
        return extension.getTextAtPath({NAME: NAME_VALUE, PATH: read.path}, util);
      case 'has':
        return extension.hasPath({NAME: NAME_VALUE, PATH: read.path}, util);
      case 'keys':
        return extension.keysAtPath({NAME: NAME_VALUE, PATH: read.path}, util);
      case 'length':
        return extension.lengthAtPath({NAME: NAME_VALUE, PATH: read.path}, util);
    }
  });
}

function serverStatements(scenario: Scenario): StatementSpec[] {
  const statements: StatementSpec[] = scenario.steps.map((step) => {
    if (step.op === 'parseJson') return block(`${SD}parseJson`, {NAME: resolveServer(step.name), TEXT: resolveServer(step.text)});
    if (step.op === 'set') {
      return block(`${SD}setJsonAtPath`, {NAME: resolveServer(step.name), PATH: step.path, VALUE: resolveServer(step.value)});
    }
    if (step.op === 'delete') return block(`${SD}deleteAtPath`, {NAME: resolveServer(step.name), PATH: step.path});
    return block(`${SD}deleteStructuredData`, {NAME: resolveServer(step.name)});
  });
  const read = scenario.read;
  const opcode = {
    hasData: 'hasStructuredData',
    toJson: 'toJson',
    get: 'getJsonAtPath',
    getText: 'getTextAtPath',
    has: 'hasPath',
    keys: 'keysAtPath',
    length: 'lengthAtPath'
  }[read.op];
  const inputs: Record<string, InputSpec> = {NAME: resolveServer(read.name)};
  if ('path' in read) inputs.PATH = read.path;
  return [...statements, respondText(reporter(`${SD}${opcode}`, inputs))];
}
