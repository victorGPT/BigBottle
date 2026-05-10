import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const localeDir = path.join(root, 'src/i18n/locales');
const localeFiles = {
  en: 'en.ts',
  'zh-Hans': 'zh-Hans.ts',
  'zh-Hant': 'zh-Hant.ts',
  ja: 'ja.ts'
};

const allowedLiteralText = new Set(['BigBottle', 'Big Bottle']);
const userTextAttributes = new Set(['aria-label', 'alt', 'placeholder', 'title']);

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function readLocale(fileName) {
  const source = fs.readFileSync(path.join(localeDir, fileName), 'utf8');
  const start = source.indexOf('= ');
  const end = source.indexOf(' as const', start);
  if (start < 0 || end < 0) throw new Error(`Cannot parse locale file: ${fileName}`);
  return Function(`return (${source.slice(start + 2, end)});`)();
}

function sortedKeys(locale) {
  return Object.keys(locale.app).sort();
}

function interpolationVars(value) {
  const vars = new Set();
  for (const match of String(value).matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    vars.add(match[1]);
  }
  return [...vars].sort();
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function checkLocales() {
  const locales = Object.fromEntries(
    Object.entries(localeFiles).map(([language, fileName]) => [language, readLocale(fileName)])
  );

  const sourceKeys = sortedKeys(locales.en);
  for (const [language, locale] of Object.entries(locales)) {
    const keys = sortedKeys(locale);
    const missing = sourceKeys.filter((key) => !keys.includes(key));
    const extra = keys.filter((key) => !sourceKeys.includes(key));

    if (missing.length) fail(`[i18n] ${language} missing keys: ${missing.join(', ')}`);
    if (extra.length) fail(`[i18n] ${language} extra keys: ${extra.join(', ')}`);

    for (const key of sourceKeys) {
      const expected = interpolationVars(locales.en.app[key]);
      const actual = interpolationVars(locale.app[key]);
      if (!arraysEqual(expected, actual)) {
        fail(`[i18n] ${language}.${key} interpolation mismatch: expected {{${expected.join('}}, {{')}}}, got {{${actual.join('}}, {{')}}}`);
      }
    }
  }
}

function walk(dir, result = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, result);
    if (entry.isFile() && fullPath.endsWith('.tsx')) result.push(fullPath);
  }
  return result;
}

function normalizeText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function hasHumanText(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (allowedLiteralText.has(normalized)) return false;
  return /[\p{L}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(normalized);
}

function locationOf(sourceFile, node) {
  const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${path.relative(root, sourceFile.fileName)}:${pos.line + 1}:${pos.character + 1}`;
}

function checkNode(sourceFile, node) {
  if (ts.isJsxText(node) && hasHumanText(node.getText(sourceFile))) {
    fail(`[i18n] Hardcoded JSX text at ${locationOf(sourceFile, node)}: ${normalizeText(node.getText(sourceFile))}`);
  }

  if (ts.isJsxAttribute(node) && userTextAttributes.has(node.name.getText(sourceFile))) {
    const initializer = node.initializer;
    if (initializer && ts.isStringLiteral(initializer) && hasHumanText(initializer.text)) {
      fail(`[i18n] Hardcoded ${node.name.getText(sourceFile)} at ${locationOf(sourceFile, node)}: ${initializer.text}`);
    }
  }

  if (ts.isJsxExpression(node) && node.expression && ts.isStringLiteral(node.expression) && hasHumanText(node.expression.text)) {
    fail(`[i18n] Hardcoded JSX expression at ${locationOf(sourceFile, node)}: ${node.expression.text}`);
  }

  ts.forEachChild(node, (child) => checkNode(sourceFile, child));
}

function checkHardcodedJsxText() {
  for (const filePath of walk(path.join(root, 'src/app'))) {
    const source = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    checkNode(sourceFile, sourceFile);
  }
}

checkLocales();
checkHardcodedJsxText();

if (!process.exitCode) {
  console.log('[i18n] locale keys, interpolation variables, and JSX text checks passed');
}
