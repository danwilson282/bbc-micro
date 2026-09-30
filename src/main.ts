// Browser entry point. Builds the Part 2 "CPU playground" (a flat 64K
// TestBus, no CPU yet) and mounts the workbench beside the screen canvas.

import { TestBus } from './memory/test-bus';
import { hex16, hex8 } from './util/bits';
import { testBusTarget } from './web/workbench/debug-target';
import { createMemoryPanel } from './web/workbench/memory-panel';
import { createWorkbench } from './web/workbench/panel';

const canvas = document.querySelector<HTMLCanvasElement>('#screen');
if (!canvas) throw new Error('Missing #screen canvas');
const host = document.querySelector<HTMLElement>('#workbench');
if (!host) throw new Error('Missing #workbench element');

// &7C00 is where Mode 7 screen memory starts on a real Model B (AUG, memory
// map). Nothing draws it yet, but it's a familiar place to put a message.
const MODE7_SCREEN = 0x7c00;
const bus = new TestBus();
bus.load(MODE7_SCREEN, Array.from('HELLO, BBC MICRO', (c) => c.charCodeAt(0)));

const target = testBusTarget(bus);
const workbench = createWorkbench(host, target.name);
const memory = createMemoryPanel(target, {
  start: MODE7_SCREEN,
  onPoke: () => {
    workbench.refreshAll();
  },
});
workbench.add(memory);

// A console handle for experimenting in DevTools, e.g.
//   workbench.poke(0x7c10, 0x21)   // then watch the panel
Object.assign(window, {
  workbench: {
    peek: (address: number): string => `&${hex8(target.peek(address))}`,
    poke: (address: number, value: number): void => {
      target.poke(address, value);
      workbench.refreshAll();
    },
    goTo: (address: number): void => {
      memory.goTo(address);
    },
    help: `workbench.poke(0x${hex16(MODE7_SCREEN)}, 0x41), workbench.peek(addr), workbench.goTo(addr)`,
  },
});
