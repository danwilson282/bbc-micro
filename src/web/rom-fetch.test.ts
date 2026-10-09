import { BbcMemoryMap } from '../memory/bbc-memory-map';
import { fetchRom, fetchStandardRoms, type RomFetch, type RomResponse } from './rom-fetch';

function reply(body: Uint8Array | string, status = 200, contentType = 'application/octet-stream'): RomResponse {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
  };
}

/** A fake server: url → response. Anything else is a 404. */
function server(files: Record<string, RomResponse>): RomFetch {
  return (url) => Promise.resolve(files[url] ?? reply('', 404));
}

describe('fetchRom: loading a ROM file in the browser', () => {
  it('fits a 16K reply to an image', async () => {
    const result = await fetchRom('/roms/a.rom', server({ '/roms/a.rom': reply(new Uint8Array(0x4000).fill(0xbb)) }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.image[0x3fff]).toBe(0xbb);
  });

  it('mirrors an 8K reply, as toRomImage does', async () => {
    const result = await fetchRom('/roms/a.rom', server({ '/roms/a.rom': reply(new Uint8Array(0x2000).fill(0x11)) }));
    expect(result.ok && result.image.length).toBe(0x4000);
  });

  it('reports a 404 rather than throwing', async () => {
    expect(await fetchRom('/roms/none.rom', server({}))).toEqual({ ok: false, reason: '/roms/none.rom: HTTP 404' });
  });

  it("rejects the dev server's index.html fallback, which arrives with status 200", async () => {
    const files = { '/roms/dfs.rom': reply('<!doctype html><title>BBC Micro</title>', 200, 'text/html') };
    const result = await fetchRom('/roms/dfs.rom', server(files));
    expect(result).toEqual({ ok: false, reason: '/roms/dfs.rom: not found (the server sent an HTML page)' });
  });

  it('rejects a reply of the wrong size, naming the URL', async () => {
    const result = await fetchRom('/roms/a.rom', server({ '/roms/a.rom': reply(new Uint8Array(1000)) }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/\/roms\/a\.rom is 1000 bytes/);
  });

  it('reports a network error rather than throwing', async () => {
    const result = await fetchRom('/roms/a.rom', () => Promise.reject(new Error('offline')));
    expect(result).toEqual({ ok: false, reason: '/roms/a.rom: offline' });
  });
});

describe('fetchStandardRoms', () => {
  it('loads what the server has into the map, and lists the rest as missing', async () => {
    const map = new BbcMemoryMap();
    const files = {
      '/roms/os12.rom': reply(new Uint8Array(0x4000).fill(0xcc)),
      '/roms/basic2.rom': reply(new Uint8Array(0x4000).fill(0xbb)),
    };
    const report = await fetchStandardRoms(map, '/roms/', server(files));
    expect(report.loaded.map((r) => r.id)).toEqual(['mos', 'basic']);
    expect(report.missing.map((r) => r.id)).toEqual(['dfs']);
    expect(map.read(0xc000)).toBe(0xcc);
    expect(map.sidewaysRom(15)?.[0]).toBe(0xbb);
    expect(map.sidewaysRom(14)).toBeUndefined();
  });
});
