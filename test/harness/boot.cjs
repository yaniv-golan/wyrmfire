// Boot WYRMFIRE in CLOADM headless through its public Node API (js/emu.js).
// SPDX-License-Identifier: GPL-3.0-or-later
//
// A Dragon 64 (64 KB) with a bare Dragon disk controller (no DOS ROM) in the
// cartridge port; the level disk is mounted in drive 0 and the engine binary
// is loaded and started directly.
//   const s = await require('./boot.cjs')(cloadmDir, { bin, vdk });
const fs = require('node:fs'), path = require('node:path');

function emu(repo) { return require(path.resolve(repo, 'js/emu.js')); }

async function boot(repo, { bin, vdk }) {
  const Emu = emu(repo);
  const s = new Emu.Session({ welcomeMenu: false });
  s.switchMachine('dragon64', { ram: 64 }, { menu: false });
  const fdc = new Emu.devices.dragonfdc();
  s.machine.insertCartridge(fdc);
  s.swapLevelDisk = (bytes) => fdc.mount(0, { bytes: new Uint8Array(bytes), format: 'vdk', name: 'WYRMFIRE.VDK', writeProtected: true });
  s.swapLevelDisk(fs.readFileSync(vdk));
  await s.load('WYRMFIRE.BIN', new Uint8Array(fs.readFileSync(bin)));
  s.Emu = Emu;
  return s;
}

// Symbols from the CMOC link map: { px: 0x1234, ... }
function symbols(map) {
  return Object.fromEntries([...fs.readFileSync(map, 'utf8').matchAll(/^Symbol: _(\w+) \(native\.o\) = ([0-9A-F]+)/gm)].map((m) => [m[1], parseInt(m[2], 16)]));
}

// Files for a run. DIR must hold wyrmfire.vdk (a level disk from the
// converter); wyrmfire.bin and engine.map are taken from DIR when present
// (a fresh tools/build-engine.sh build), else from the committed
// bin/wyrmfire.bin and its symbol list bin/wyrmfire.sym, so no CMOC is needed.
const ROOT = path.resolve(__dirname, '../..');
function layout(dir) {
  const pick = (own, committed) => (fs.existsSync(path.join(dir, own)) ? path.join(dir, own) : path.join(ROOT, 'bin', committed));
  return { bin: pick('wyrmfire.bin', 'wyrmfire.bin'), vdk: path.join(dir, 'wyrmfire.vdk'), map: pick('engine.map', 'wyrmfire.sym') };
}

// PNG of the current screen, via CLOADM's CLI encoder.
function png(repo, s) { return require(path.resolve(repo, 'cli/cloadm.js')).framePng(s.machine.render()); }

// Engine RAM map (src/disk.h): GRID and the HGR2 header location on the disk.
const GRID = 0xac00, PACK = 0x6e00, HEADER_SECTOR = 30;

module.exports = Object.assign(boot, { boot, emu, symbols, layout, png, GRID, PACK, HEADER_SECTOR });
