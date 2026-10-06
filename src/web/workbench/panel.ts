// The workbench: debug panels, in plain DOM.
//
// A panel owns one element and knows how to redraw itself from the emulator's
// current state. The workbench doesn't know what's inside a panel. It only
// lays them out and tells them all to refresh when something has changed
// (a poke now, a CPU Step from Stage 04, every frame from Stage 30).
//
// Each panel's heading has a − / + button that hides or shows its body. The
// choice is remembered per browser in localStorage, which is only a
// convenience: if storage is blocked, panels simply start open.

export interface Panel {
  readonly title: string;
  /** The panel's body. The workbench wraps it in a titled section. */
  readonly element: HTMLElement;
  /** Redraw from the current emulator state. */
  refresh(): void;
}

export interface Workbench {
  /** Adds a panel at the end of host (default: the workbench's own column). */
  add(panel: Panel, host?: HTMLElement): void;
  refreshAll(): void;
}

const COLLAPSED_KEY = 'workbench.collapsed';

/** The titles of the panels the viewer has hidden. Storage can throw or be empty: then none are. */
function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    // JSON.parse returns unknown data from storage: check it's a string array before trusting it.
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveCollapsed(collapsed: ReadonlySet<string>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
  } catch {
    // Blocked storage: the panel still hides, it just won't be remembered.
  }
}

/** Creates a workbench inside host, headed with the target's name. */
export function createWorkbench(host: HTMLElement, targetName: string): Workbench {
  const panels: Panel[] = [];
  const collapsed = loadCollapsed();

  const header = document.createElement('p');
  header.className = 'workbench-target';
  header.textContent = `Target: ${targetName}`;
  host.append(header);

  return {
    add(panel, where = host) {
      const section = document.createElement('section');
      section.className = 'panel';
      section.dataset.panel = panel.title;
      section.setAttribute('aria-label', panel.title);
      const heading = document.createElement('h2');
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'panel-toggle';
      let isOpen = true;
      const show = (open: boolean): void => {
        isOpen = open;
        panel.element.hidden = !open;
        section.classList.toggle('collapsed', !open);
        toggle.textContent = open ? '−' : '+';
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} ${panel.title}`);
      };
      toggle.addEventListener('click', () => {
        const open = !isOpen;
        show(open);
        if (open) collapsed.delete(panel.title);
        else collapsed.add(panel.title);
        saveCollapsed(collapsed);
      });
      show(!collapsed.has(panel.title));
      heading.append(panel.title, toggle);
      section.append(heading, panel.element);
      where.append(section);
      panels.push(panel);
      panel.refresh();
    },
    refreshAll() {
      for (const panel of panels) panel.refresh();
    },
  };
}
