import type {PathSegmentV2} from '../ir-v2/types.js';

export function parseStructuredDataPath(input: string): PathSegmentV2[] {
  if (!input.startsWith('$')) throw new Error('Path must start with $.');
  const segments: PathSegmentV2[] = [];
  let cursor = 1;
  while (cursor < input.length) {
    if (input[cursor] === '.') {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(input.slice(cursor + 1));
      if (match === null) throw new Error('Invalid identifier path segment.');
      segments.push({kind: 'key', value: match[0]});
      cursor += match[0].length + 1;
      continue;
    }
    if (input[cursor] !== '[') throw new Error('Expected a bracket path segment.');
    cursor += 1;
    if (input[cursor] === '"') {
      const end = scanJsonString(input, cursor);
      let key: unknown;
      try {
        key = JSON.parse(input.slice(cursor, end));
      } catch {
        throw new Error('Invalid quoted path key.');
      }
      if (typeof key !== 'string' || input[end] !== ']') throw new Error('Invalid quoted path key.');
      segments.push({kind: 'key', value: key});
      cursor = end + 1;
      continue;
    }
    const match = /^(0|[1-9][0-9]*)\]/u.exec(input.slice(cursor));
    if (match === null) throw new Error('Invalid array index path segment.');
    const index = Number(match[1]);
    if (!Number.isSafeInteger(index)) throw new Error('Array index is not a safe integer.');
    segments.push({kind: 'index', value: index});
    cursor += match[0].length;
  }
  return segments;
}

function scanJsonString(path: string, start: number): number {
  let escaped = false;
  for (let index = start + 1; index < path.length; index += 1) {
    const character = path[index];
    if (escaped) {
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '"') {
      return index + 1;
    }
  }
  throw new Error('Unterminated quoted path key.');
}
