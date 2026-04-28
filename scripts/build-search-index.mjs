#!/usr/bin/env node
// Build a vector search index from every .mdx in this docs site.
// Reads search.config.json. Writes public/search-index.json.
// Re-run via `npm run index` after editing pages.

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'glob';
import matter from 'gray-matter';
import { pipeline, env } from '@xenova/transformers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const configPath = join(repoRoot, 'search.config.json');
const DEFAULT_OUTPUT = 'assets/search-index.js';
const GLOBAL_NAME = '__VSEARCH_INDEX__';

env.allowLocalModels = false;
env.useBrowserCache = false;

const log = (...args) => console.log('[index]', ...args);
const warn = (...args) => console.warn('[index]', ...args);

async function loadConfig() {
  const raw = await readFile(configPath, 'utf8');
  const cfg = JSON.parse(raw);
  if (!cfg.model) throw new Error('search.config.json: "model" is required');
  if (!Array.isArray(cfg.include) || cfg.include.length === 0)
    throw new Error('search.config.json: "include" must be a non-empty array');
  cfg.exclude ||= [];
  cfg.chunking ||= {};
  cfg.chunking.maxChars ||= 1400;
  cfg.chunking.minChars ||= 60;
  return cfg;
}

function fileToUrl(filePath) {
  // frontend/design-tokens/linear.mdx -> /frontend/design-tokens/linear
  // backend/prompts/index.mdx        -> /backend/prompts
  // index.mdx                        -> /
  let p = filePath.replaceAll(sep, '/').replace(/\.mdx$/i, '');
  if (p.endsWith('/index')) p = p.slice(0, -'/index'.length);
  if (p === 'index') return '/';
  return '/' + p;
}

// Strip MDX/JSX components but keep their text content.
// Conservative: drops opening/closing tags, keeps inner prose, drops imports.
function stripMdx(body) {
  return body
    // remove import/export lines
    .replace(/^\s*(import|export)\s.+$/gm, '')
    // remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // remove fenced code blocks (signal noise for semantic search)
    .replace(/```[\s\S]*?```/g, ' ')
    // remove inline JSX expressions {expr}
    .replace(/\{[^{}]*\}/g, ' ')
    // strip self-closing JSX tags <Foo .../>
    .replace(/<[A-Za-z][\w.-]*\b[^>]*\/>/g, ' ')
    // strip opening + closing JSX tags but keep inner text
    .replace(/<\/?[A-Za-z][\w.-]*\b[^>]*>/g, ' ')
    // collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

// Split a stripped MDX body into chunks at heading boundaries.
// Returns [{ heading, headingPath, text }]
function splitByHeading(rawBody, pageTitle, maxChars, minChars) {
  // operate on the raw MDX body so we can see headings before stripping
  const lines = rawBody.split(/\r?\n/);
  const sections = [];
  let current = { level: 1, heading: pageTitle, headingPath: [pageTitle], lines: [] };
  const stack = [pageTitle]; // keeps the breadcrumb up to the current depth

  const flush = () => {
    if (current.lines.length === 0) return;
    sections.push({
      heading: current.heading,
      headingPath: [...current.headingPath],
      text: stripMdx(current.lines.join('\n')),
    });
  };

  for (const line of lines) {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (m) {
      flush();
      const level = m[1].length;
      const heading = m[2].trim();
      // adjust breadcrumb stack to this depth (cap at level)
      stack.length = Math.max(1, Math.min(level, stack.length + 1));
      stack[level - 1] = heading;
      // truncate anything deeper
      stack.length = level;
      // make sure stack[0] always exists as page title
      if (level > 1 && !stack[0]) stack[0] = pageTitle;
      current = { level, heading, headingPath: stack.slice(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  flush();

  // further split overly long sections by paragraph windows
  const out = [];
  for (const sec of sections) {
    if (sec.text.length <= maxChars) {
      if (sec.text.length >= minChars) out.push(sec);
      continue;
    }
    // window the text
    let i = 0;
    while (i < sec.text.length) {
      const slice = sec.text.slice(i, i + maxChars);
      if (slice.length >= minChars) {
        out.push({ heading: sec.heading, headingPath: sec.headingPath, text: slice });
      }
      i += maxChars;
    }
  }
  return out;
}

function buildSnippet(text, maxChars = 220) {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).replace(/\s+\S*$/, '') + '...';
}

function l2norm(vec) {
  let sum = 0;
  for (const v of vec) sum += v * v;
  return Math.sqrt(sum) || 1;
}

function normalize(vec) {
  const n = l2norm(vec);
  const out = new Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / n;
  return out;
}

async function main() {
  const cfg = await loadConfig();
  log('config', { model: cfg.model, include: cfg.include, exclude: cfg.exclude.length });

  const files = await glob(cfg.include, {
    cwd: repoRoot,
    ignore: cfg.exclude,
    nodir: true,
  });
  files.sort();
  log(`found ${files.length} mdx files`);

  log('loading model:', cfg.model);
  const embedder = await pipeline('feature-extraction', cfg.model);

  const chunks = [];
  let dim = cfg.modelDimension || 0;

  for (const rel of files) {
    const abs = join(repoRoot, rel);
    const raw = await readFile(abs, 'utf8');
    const fm = matter(raw);
    const title = (fm.data.title || rel.replace(/\.mdx$/i, '')).toString();
    const description = (fm.data.description || '').toString();
    const url = fileToUrl(rel);

    const sections = splitByHeading(
      fm.content,
      title,
      cfg.chunking.maxChars,
      cfg.chunking.minChars
    );

    if (sections.length === 0) continue;

    for (const sec of sections) {
      // include heading path + description as anchor text — improves recall
      const anchor = [title, description, ...sec.headingPath, sec.heading]
        .filter(Boolean)
        .join(' — ');
      const text = `${anchor}. ${sec.text}`.slice(0, 4000);

      const out = await embedder(text, { pooling: 'mean', normalize: true });
      const vec = Array.from(out.data);
      if (!dim) dim = vec.length;

      chunks.push({
        url,
        title,
        description,
        heading: sec.heading,
        headingPath: sec.headingPath,
        snippet: buildSnippet(sec.text),
        text: sec.text.slice(0, 1200),
        vector: vec,
      });
    }
    log(`indexed ${rel} → ${sections.length} chunk(s)`);
  }

  const outRel = (cfg.outputPath || DEFAULT_OUTPUT).replace(/^\/+/, '');
  const outFile = join(repoRoot, outRel);
  const outDir = dirname(outFile);
  await mkdir(outDir, { recursive: true });

  const index = {
    version: 1,
    builtAt: new Date().toISOString(),
    model: cfg.model,
    dimension: dim,
    transformersVersion: cfg.transformersVersion || '2.17.2',
    ui: cfg.ui || {},
    chunks,
  };

  // Mintlify's dev server doesn't serve .json. We emit a .js module that
  // assigns the index to a global and dispatches a ready event.
  const isJsOutput = outFile.endsWith('.js');
  const payload = isJsOutput
    ? `window.${GLOBAL_NAME} = ${JSON.stringify(index)};\n` +
      `window.dispatchEvent(new Event('vsearch:index-loaded'));\n`
    : JSON.stringify(index);
  await writeFile(outFile, payload);
  const sizeKb = (await stat(outFile)).size / 1024;
  log(`wrote ${relative(repoRoot, outFile)} (${chunks.length} chunks, ${sizeKb.toFixed(0)} KB)`);
}

main().catch((err) => {
  console.error('[index] FAILED');
  console.error(err);
  process.exit(1);
});
