import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { IGNORED_DIRS, lineCounter, sourceRoots, stripComments } from './source-scan.ts';

export interface SourceLine {
  file: string;
  line: number;
  text: string;
}

export interface FormSource {
  form?: SourceLine;
  rules: SourceLine[];
}

const MAX_FILES = 5000;
const CACHE_MS = 10_000;
const RULE_CALL =
  /\b(required|validate\w*|min|max|minLength|maxLength|minDate|maxDate|pattern|email|disabled|hidden|readonly|debounce|metadata|applyWhen\w*|applyEach|Validators\.\w+)\s*\(/;

let cache: {
  cwd: string;
  at: number;
  files: string[];
  contents: Map<string, string | null>;
  found: Map<string, FormSource | null>;
} | null = null;

function listFiles(cwd: string): string[] {
  if (cache && cache.cwd === cwd && Date.now() - cache.at < CACHE_MS) return cache.files;
  const files: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      const full = join(dir, entry);
      try {
        const stats = lstatSync(full);
        if (stats.isSymbolicLink()) continue;
        if (stats.isDirectory()) {
          if (!IGNORED_DIRS.has(entry.toLowerCase())) walk(full);
          continue;
        }
      } catch {
        continue;
      }
      if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts') && !entry.endsWith('.d.ts')) {
        files.push(full);
      }
    }
  };
  for (const root of sourceRoots(cwd)) walk(root);
  cache = { cwd, at: Date.now(), files, contents: new Map(), found: new Map() };
  return files;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function classBody(source: string, owner: string): { start: number; end: number } | null {
  const match = new RegExp(`\\bclass\\s+_*${escape(owner)}\\b`).exec(source);
  if (!match) return null;
  const open = source.indexOf('{', match.index);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return { start: match.index, end: i };
  }
  return { start: match.index, end: source.length };
}

export function formSourceIn(
  content: string,
  file: string,
  owner: string,
  property: string | undefined,
  path: string,
): FormSource | null {
  const source = stripComments(content);
  const body = classBody(source, owner);
  if (!body) return null;
  const lineOf = lineCounter(source);
  const lines = content.split('\n');
  const at = (index: number): SourceLine => {
    const line = lineOf(index);
    return { file, line, text: (lines[line - 1] ?? '').trim().slice(0, 160) };
  };
  const scope = source.slice(body.start, body.end);
  const result: FormSource = { rules: [] };
  const declared = property
    ? new RegExp(`\\b${escape(property)}\\s*(?::[^=;]+)?=`).exec(scope)
    : null;
  result.form = at(body.start + (declared ? declared.index : 0));
  const key = path
    .split('.')
    .filter((k) => !/^\d+$/.test(k))
    .pop();
  if (!key) return result;
  const field = new RegExp(`(\\.${escape(key)}\\b|\\b${escape(key)}\\s*:)`);
  let offset = 0;
  for (const text of scope.split('\n')) {
    if (
      field.test(text) &&
      (RULE_CALL.test(text) || /new Form(Control|Group|Array)|\bfb\.|\[\s*['"]/.test(text))
    ) {
      result.rules.push(at(body.start + offset));
      if (result.rules.length >= 10) break;
    }
    offset += text.length + 1;
  }
  return result;
}

export function findFormSource(
  cwd: string,
  owner: string,
  property: string | undefined,
  path = '',
): FormSource | null {
  if (!owner || owner === 'Unknown') return null;
  const files = listFiles(cwd);
  const key = `${owner}|${property ?? ''}|${path}`;
  const known = cache?.found.get(key);
  if (known !== undefined) return known;
  let result: FormSource | null = null;
  const needle = new RegExp(`\\bclass\\s+_*${escape(owner)}\\b`);
  for (const full of files) {
    const content = readCached(full);
    if (content === null || !needle.test(content)) continue;
    result = formSourceIn(content, relative(cwd, full), owner, property, path);
    if (result) break;
  }
  cache?.found.set(key, result);
  return result;
}

function readCached(full: string): string | null {
  const known = cache?.contents.get(full);
  if (known !== undefined) return known;
  let content: string | null;
  try {
    content = readFileSync(full, 'utf-8');
  } catch {
    content = null;
  }
  cache?.contents.set(full, content);
  return content;
}

export function sourceText(source: FormSource | null): string {
  if (!source?.form) return '';
  const out = [`Defined at ${source.form.file}:${source.form.line}: ${source.form.text}`];
  for (const rule of source.rules) out.push(`- ${rule.file}:${rule.line}: ${rule.text}`);
  return out.join('\n');
}
