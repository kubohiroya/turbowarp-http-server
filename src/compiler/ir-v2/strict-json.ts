export interface StrictJsonParseOptions {
  maxDepth?: number;
}

export function parseJsonWithoutDuplicateKeys(text: string, options: StrictJsonParseOptions = {}): unknown {
  const scanner = new JsonStructureScanner(text, options.maxDepth ?? Number.POSITIVE_INFINITY);
  scanner.scan();
  return JSON.parse(text) as unknown;
}

class JsonStructureScanner {
  private index = 0;

  public constructor(
    private readonly text: string,
    private readonly maxDepth: number
  ) {}

  public scan(): void {
    this.skipWhitespace();
    this.value(0);
    this.skipWhitespace();
    if (this.index !== this.text.length) this.fail('Unexpected trailing content');
  }

  private value(depth: number): void {
    if (depth > this.maxDepth) this.fail(`JSON nesting depth exceeds ${this.maxDepth}`);
    this.skipWhitespace();
    const token = this.text[this.index];
    if (token === '{') return this.object(depth);
    if (token === '[') return this.array(depth);
    if (token === '"') {
      this.string();
      return;
    }
    if (this.text.startsWith('true', this.index)) return this.advance(4);
    if (this.text.startsWith('false', this.index)) return this.advance(5);
    if (this.text.startsWith('null', this.index)) return this.advance(4);
    this.number();
  }

  private object(depth: number): void {
    this.index += 1;
    this.skipWhitespace();
    const keys = new Set<string>();
    if (this.consume('}')) return;
    while (true) {
      this.skipWhitespace();
      if (this.text[this.index] !== '"') this.fail('Expected an object key');
      const key = this.string();
      if (keys.has(key)) this.fail(`Duplicate object key: ${key}`);
      keys.add(key);
      this.skipWhitespace();
      this.expect(':');
      this.value(depth + 1);
      this.skipWhitespace();
      if (this.consume('}')) return;
      this.expect(',');
    }
  }

  private array(depth: number): void {
    this.index += 1;
    this.skipWhitespace();
    if (this.consume(']')) return;
    while (true) {
      this.value(depth + 1);
      this.skipWhitespace();
      if (this.consume(']')) return;
      this.expect(',');
    }
  }

  private string(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const token = this.text[this.index];
      if (token === '"') {
        this.index += 1;
        return JSON.parse(this.text.slice(start, this.index)) as string;
      }
      if (token === '\\') {
        this.index += 1;
        const escape = this.text[this.index];
        if (escape === 'u') {
          const digits = this.text.slice(this.index + 1, this.index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(digits)) this.fail('Invalid Unicode escape');
          this.index += 5;
          continue;
        }
        if (escape === undefined || !'"\\/bfnrt'.includes(escape)) this.fail('Invalid string escape');
        this.index += 1;
        continue;
      }
      if (token === undefined || token.charCodeAt(0) < 0x20) this.fail('Invalid string character');
      this.index += 1;
    }
    this.fail('Unterminated string');
  }

  private number(): void {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.text.slice(this.index));
    if (!match) this.fail('Expected a JSON value');
    this.index += match[0].length;
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.text[this.index] ?? '') && this.index < this.text.length) this.index += 1;
  }

  private consume(token: string): boolean {
    if (this.text[this.index] !== token) return false;
    this.index += 1;
    return true;
  }

  private expect(token: string): void {
    if (!this.consume(token)) this.fail(`Expected ${token}`);
  }

  private advance(length: number): void {
    this.index += length;
  }

  private fail(message: string): never {
    throw new SyntaxError(`${message} at JSON offset ${this.index}.`);
  }
}
