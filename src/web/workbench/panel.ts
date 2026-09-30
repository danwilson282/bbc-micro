// The workbench: a column of debug panels, in plain DOM.
//
// A panel owns one element and knows how to redraw itself from the emulator's
// current state. The workbench doesn't know what's inside a panel. It only
// lays them out and tells them all to refresh when something has changed
// (a poke now, a CPU Step from Stage 04, every frame from Stage 30).

export interface Panel {
  readonly title: string;
  /** The panel's body. The workbench wraps it in a titled section. */
  readonly element: HTMLElement;
  /** Redraw from the current emulator state. */
  refresh(): void;
}

export interface Workbench {
  add(panel: Panel): void;
  refreshAll(): void;
}

/** Creates a workbench inside host, headed with the target's name. */
export function createWorkbench(host: HTMLElement, targetName: string): Workbench {
  const panels: Panel[] = [];

  const header = document.createElement('p');
  header.className = 'workbench-target';
  header.textContent = `Target: ${targetName}`;
  host.append(header);

  return {
    add(panel) {
      const section = document.createElement('section');
      section.className = 'panel';
      section.dataset.panel = panel.title;
      section.setAttribute('aria-label', panel.title);
      const heading = document.createElement('h2');
      heading.textContent = panel.title;
      section.append(heading, panel.element);
      host.append(section);
      panels.push(panel);
      panel.refresh();
    },
    refreshAll() {
      for (const panel of panels) panel.refresh();
    },
  };
}
