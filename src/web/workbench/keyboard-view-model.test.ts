import { Keyboard, MATRIX_COLUMNS, MATRIX_ROWS } from '../../devices/keyboard';
import { DESK_ROWS, describeDown, matrixCells } from './keyboard-view-model';

function capsIn(row: number): string[] {
  return (DESK_ROWS[row] ?? []).map((cap) => (cap.kind === 'key' ? cap.legend : cap.kind));
}

describe('the desk view: the Model B keyboard as it is laid out', () => {
  it('has the function row with BREAK at its right end', () => {
    expect(capsIn(0)).toEqual(['f0', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'break']);
  });

  it('puts ESCAPE before 1, and ends the number row with ^ \\ ← →', () => {
    expect(capsIn(1)).toEqual(['ESCAPE', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '^', '\\', '←', '→']);
  });

  it('has @ [ _ after P, then ↑ ↓', () => {
    expect(capsIn(2).slice(-6)).toEqual(['P', '@', '[', '_', '↑', '↓']);
  });

  it('has CAPS LOCK then CTRL before A, and ; : ] RETURN after L', () => {
    const row = capsIn(3);
    expect(row.slice(0, 3)).toEqual(['CAPS LOCK', 'CTRL', 'A']);
    expect(row.slice(-4)).toEqual([';', ':', ']', 'RETURN']);
  });

  it('has two SHIFT keys, both the one matrix switch &00', () => {
    const shifts = (DESK_ROWS[4] ?? []).filter((cap) => cap.kind === 'key' && cap.legend === 'SHIFT');
    expect(shifts.map((cap) => (cap.kind === 'key' ? cap.key : -1))).toEqual([0x00, 0x00]);
  });

  it('shows every one of the 72 matrix keys somewhere', () => {
    const keys = new Set(DESK_ROWS.flat().flatMap((cap) => (cap.kind === 'key' ? [cap.key] : [])));
    expect(keys.size).toBe(72);
  });

  it('tells you the key number and the PC key in each key\'s tooltip', () => {
    const quote = DESK_ROWS.flat().find((cap) => cap.kind === 'key' && cap.legend === ':');
    expect(quote?.kind === 'key' ? quote.title : '').toBe(': (SHIFT: *), key &48 (row 4, column 8). PC key: \'');
  });
});

describe('the matrix view: the same switches as wired', () => {
  it('is 8 rows of 10 columns', () => {
    const cells = matrixCells();
    expect(cells).toHaveLength(MATRIX_ROWS);
    for (const row of cells) expect(row).toHaveLength(MATRIX_COLUMNS);
  });

  it('puts each key at row × 16 + column: row 4 column 1 is A (&41), row 7 column 0 is ESCAPE', () => {
    const cells = matrixCells();
    expect(cells[4]?.[1]).toMatchObject({ key: 0x41, label: 'A', kind: 'key' });
    expect(cells[7]?.[0]).toMatchObject({ key: 0x70, label: 'ESC', kind: 'key' });
  });

  it('shows row 0, columns 2-9 as the links, labelled with their &028F bit', () => {
    const cells = matrixCells();
    expect(cells[0]?.[2]).toMatchObject({ key: 0x02, label: 'b7', kind: 'link' });
    expect(cells[0]?.[9]).toMatchObject({ key: 0x09, label: 'b0', kind: 'link' });
  });
});

describe('describeDown: what is held, in words', () => {
  it('says nothing is held when nothing is', () => {
    expect(describeDown(new Keyboard())).toBe('No keys down.');
  });

  it('lists held keys with their key numbers, in matrix order', () => {
    const kb = new Keyboard();
    kb.press(0x41);
    kb.press(0x00);
    expect(describeDown(kb)).toBe('Down: SHIFT &00, A &41');
  });

  it('leaves out the links: they are not keys anyone is holding', () => {
    expect(describeDown(new Keyboard(0x00))).toBe('No keys down.');
  });
});
