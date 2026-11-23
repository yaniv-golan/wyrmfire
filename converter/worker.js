// Web Worker wrapper for the WYRMFIRE converter.
// SPDX-License-Identifier: GPL-3.0-or-later
//
//   const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
//   // one file (a .wad, the original .zip, an .lzh) ...
//   worker.postMessage({ id: 1, wad: arrayBuffer, map: 'E1M1' }, [arrayBuffer]);
//   // ... or several, e.g. the split DOOMS_19.1 + DOOMS_19.2 parts:
//   worker.postMessage({ id: 2, files: [{ name: 'DOOMS_19.1', bytes: buf1 }, { name: 'DOOMS_19.2', bytes: buf2 }] });
//   worker.onmessage = ({ data }) => data.ok ? use(data.disk, data.info) : show(data.error);
//
// Also: { id, wad | files, list: true } replies { id, ok, maps }.
import { convertAsync, listMaps, openWadAsync, VERSION } from './wyrmfire-convert.js';

self.onmessage = async (event) => {
  const { id, wad, files, map, list, sha256 } = event.data || {};
  try {
    const input = files || new Uint8Array(wad);
    if (list) {
      const source = await openWadAsync(input, { sha256 });
      self.postMessage({ id, ok: true, maps: listMaps(source.bytes), source: { name: source.name, container: source.container, sha256: source.sha256 } });
      return;
    }
    const { disk, info } = await convertAsync(input, { map, sha256 });
    self.postMessage({ id, ok: true, version: VERSION, disk, info }, [disk.buffer]);
  } catch (e) {
    self.postMessage({ id, ok: false, error: e.message, kind: e.name });
  }
};
