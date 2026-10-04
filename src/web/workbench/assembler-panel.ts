// The Assembler panel: a source editor, an example picker, and an
// "Assemble & Run" button. Ctrl+Enter (Cmd+Enter on a Mac) does the same.
//
// The panel only assembles and reports. What "Run" means (load the bytes,
// point the reset vector, reset the CPU) is main.ts's job, through
// onAssembled, so this panel works the same on any target.

import { assemble, type Assembly } from '../../asm/assembler';
import type { Example } from '../../playground/examples';
import { describeAssembly } from './assembler-view-model';
import { button } from './dom';
import type { Panel } from './panel';

export interface AssemblerPanelOptions {
  readonly examples: readonly Example[];
  /** The example the editor starts with. */
  readonly initial: Example;
  /** Called with a successful assembly that has an entry point. */
  readonly onAssembled: (assembly: Extract<Assembly, { ok: true }>, entry: number) => void;
}

export function createAssemblerPanel(options: AssemblerPanelOptions): Panel & { assembleAndRun(): void } {
  const element = document.createElement('div');
  element.className = 'assembler-panel';

  const toolbar = document.createElement('div');
  toolbar.className = 'asm-toolbar';
  const picker = document.createElement('select');
  picker.setAttribute('aria-label', 'Example program');
  for (const example of options.examples) {
    const option = document.createElement('option');
    option.value = example.id;
    option.textContent = example.title;
    picker.append(option);
  }
  picker.value = options.initial.id;
  const run = button('Assemble & Run', 'Assemble and run');
  run.title = 'Ctrl+Enter';
  toolbar.append(picker, run);

  const editor = document.createElement('textarea');
  editor.className = 'asm-source';
  editor.setAttribute('aria-label', 'Assembly source');
  editor.spellcheck = false;
  editor.rows = 20;
  editor.value = options.initial.source;

  const status = document.createElement('p');
  status.className = 'asm-status';
  status.setAttribute('role', 'status');

  const errors = document.createElement('ul');
  errors.className = 'asm-errors';
  errors.setAttribute('aria-label', 'Assembly errors');

  const symbols = document.createElement('p');
  symbols.className = 'asm-symbols';
  symbols.dataset.field = 'symbols';

  element.append(toolbar, editor, status, errors, symbols);

  function assembleAndRun(): void {
    const result = assemble(editor.value);
    const view = describeAssembly(result);
    status.textContent = view.status;
    status.classList.toggle('error', view.isError);
    errors.replaceChildren(
      ...view.errors.map((text) => {
        const li = document.createElement('li');
        li.textContent = text;
        return li;
      }),
    );
    symbols.textContent = view.symbols === '' ? '' : `Labels: ${view.symbols}`;
    if (result.ok && result.entry !== undefined) options.onAssembled(result, result.entry);
  }

  run.addEventListener('click', assembleAndRun);
  editor.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      assembleAndRun();
    }
  });
  picker.addEventListener('change', () => {
    const example = options.examples.find((e) => e.id === picker.value);
    if (example !== undefined) editor.value = example.source;
  });

  // Nothing to redraw when the CPU steps: the source only changes when you type.
  return { title: 'Assembler', element, refresh: () => undefined, assembleAndRun };
}
