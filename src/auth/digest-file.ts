import {readFile, rename, writeFile} from 'node:fs/promises';
import {createHa1} from './digest.js';
import type {DigestCredentialStore} from './digest.js';

export interface HtdigestEntry {
  username: string;
  realm: string;
  ha1: string;
}

export class HtdigestFile implements DigestCredentialStore {
  public constructor(private readonly path: string) {}

  public async getHa1(username: string, realm: string): Promise<string | undefined> {
    const entries = await readHtdigestFile(this.path);
    return entries.find((entry) => entry.username === username && entry.realm === realm)?.ha1;
  }
}

export async function readHtdigestFile(path: string): Promise<HtdigestEntry[]> {
  let text = '';
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return [];
    throw error;
  }

  const entries: HtdigestEntry[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const parts = line.split(':');
    const [username, realm, ha1] = parts;
    if (parts.length !== 3 || !username || !realm || !ha1 || !/^[0-9a-f]{32}$/i.test(ha1)) {
      throw new Error(`Invalid htdigest entry at ${path}:${index + 1}.`);
    }
    entries.push({
      username,
      realm,
      ha1: ha1.toLowerCase()
    });
  }
  return entries;
}

export async function writeHtdigestFile(path: string, entries: readonly HtdigestEntry[]): Promise<void> {
  const body = entries
    .map((entry) => `${entry.username}:${entry.realm}:${entry.ha1.toLowerCase()}`)
    .join('\n');
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, body ? `${body}\n` : '', {mode: 0o600});
  await rename(tmpPath, path);
}

export async function setHtdigestPassword(
  path: string,
  username: string,
  realm: string,
  password: string
): Promise<'created' | 'updated'> {
  validateField('username', username);
  validateField('realm', realm);
  const entries = await readHtdigestFile(path);
  const ha1 = createHa1(username, realm, password);
  const existing = entries.find((entry) => entry.username === username && entry.realm === realm);
  if (existing) {
    existing.ha1 = ha1;
    await writeHtdigestFile(path, entries);
    return 'updated';
  }
  entries.push({username, realm, ha1});
  entries.sort((left, right) =>
    `${left.realm}\0${left.username}`.localeCompare(`${right.realm}\0${right.username}`)
  );
  await writeHtdigestFile(path, entries);
  return 'created';
}

export async function updateHtdigestPassword(
  path: string,
  username: string,
  realm: string,
  password: string
): Promise<boolean> {
  validateField('username', username);
  validateField('realm', realm);
  const entries = await readHtdigestFile(path);
  const existing = entries.find((entry) => entry.username === username && entry.realm === realm);
  if (!existing) return false;
  existing.ha1 = createHa1(username, realm, password);
  await writeHtdigestFile(path, entries);
  return true;
}

export async function deleteHtdigestUser(
  path: string,
  username: string,
  realm: string
): Promise<boolean> {
  const entries = await readHtdigestFile(path);
  const nextEntries = entries.filter((entry) => entry.username !== username || entry.realm !== realm);
  if (nextEntries.length === entries.length) return false;
  await writeHtdigestFile(path, nextEntries);
  return true;
}

export function validateField(name: 'username' | 'realm', value: string): void {
  if (!value || /[:\r\n]/.test(value)) {
    throw new Error(`${name} must be non-empty and must not contain colon or line breaks.`);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
