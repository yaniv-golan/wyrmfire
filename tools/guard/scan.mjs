#!/usr/bin/env node
// The repository guard: no level data, no WAD bytes, no personal e-mail
// addresses, no session trailers.
// SPDX-License-Identifier: GPL-3.0-or-later
//
//   node tools/guard/scan.mjs REPO
//
// Scans every file at HEAD. Fails (exit 1) on:
//   - WAD data: a file starting with IWAD/PWAD, or holding a WAD directory
//     signature (PLAYPAL or E1M1/MAP01 marker followed by THINGS);
//   - files of level-data types (.wad .vdk .lvl .lmp .lzh .lha .zip .exe);
//   - forbidden words (WORDS below; Freedoom's verbatim credits excepted),
//     and "doom" inside the engine (src/, bin/);
//   - e-mail addresses other than the allowed GitHub noreply author and the
//     third-party credits under LICENSES/;
//   - AI-session links or trailers (SESSION below).
// The patterns are assembled from pieces so this file does not match itself.
import { execFileSync } from 'node:child_process';

const [repo] = process.argv.slice(2);
if (!repo) { console.error('usage: scan.mjs REPO'); process.exit(2); }
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { maxBuffer: 1 << 30 });
const ALLOWED_EMAILS = new Set(['5079117+yaniv-golan@users.noreply.github.com']);
const THIRD_PARTY = /^LICENSES\/freedoom-/;
const LEVEL_EXT = /\.(wad|vdk|lvl|lmp|lzh|lha|zip|exe)$/i;
const w = (...p) => new RegExp(p.join(''), 'i');
const WORDS = [w('han', 'gar'), w('port', ' of'), w('origin', 'ally')];
const SESSION = [w('claude\\.ai/code/', 'session'), w('Claude-', 'Session:'), w('Co-Authored', '-By:\\s*Claude'), w('session', '_0[0-9A-Za-z]{20,}')];
const findings = [];
const add = (where, what) => findings.push(`${where}: ${what}`);

function scanBytes(where, path, bytes) {
  if (LEVEL_EXT.test(path)) add(where, 'level-data file type');
  const head = bytes.subarray(0, 4).toString('latin1');
  if (head === 'IWAD' || head === 'PWAD') add(where, 'starts with a WAD header');
  const raw = bytes.toString('latin1');
  if (/PLAYPAL\0/.test(raw) || /(E\dM\d|MAP\d\d)\0{3,4}[\s\S]{8}THINGS\0\0/.test(raw)) add(where, 'contains a WAD directory signature');
  if (/\0/.test(raw.slice(0, 8000)) && !/\.(bin|sym)$/.test(path)) return; // other binaries: header checks only
  const text = raw;
  for (const re of WORDS) if (re.test(text) && !THIRD_PARTY.test(path)) add(where, 'forbidden word ' + re);
  if (/^(src|bin)\//.test(path) && /doom/i.test(text)) add(where, '"doom" in the engine');
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
    if (!ALLOWED_EMAILS.has(m[0]) && !THIRD_PARTY.test(path)) add(where, 'e-mail ' + m[0]);
  }
  for (const re of SESSION) if (re.test(text)) add(where, 'AI-session link or trailer ' + re);
}

// Files at HEAD.
const files = git('ls-tree', '-r', '-z', '--name-only', 'HEAD').toString().split('\0').filter(Boolean);
for (const f of files) scanBytes(`HEAD:${f}`, f, git('show', `HEAD:${f}`));

console.log(`scanned ${files.length} files at HEAD`);
if (findings.length) { console.log('FINDINGS:\n  ' + findings.join('\n  ')); process.exit(1); }
console.log('clean');
