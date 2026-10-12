// A device that can pull the CPU's /IRQ line low (Stage 26).
//
// /IRQ is open-drain on the Model B: every device that can interrupt is wired
// to the same line, and any one of them can pull it low. Nothing drives it
// high (a resistor does), so the line is low while ANY device holds it: a
// "wire-OR". Whoever owns the devices ORs their irq after each step and copies
// the result to the CPU (BUILD-PLAN §3).

export interface IrqSource {
  /** true while this device pulls /IRQ low. */
  readonly irq: boolean;
}

/** An IRQ source with a name, so a debugger can say who is holding the line. */
export interface NamedIrqSource {
  readonly name: string;
  readonly source: IrqSource;
}
