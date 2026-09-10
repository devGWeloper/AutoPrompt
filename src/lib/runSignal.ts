// The abort signal of the evaluation run executing on the current async stack.
//
// A run's work is spread over many layers — the agent call, the judge LLM, the
// embedding endpoint — and every one of them is a `fetch` with a timeout
// measured in minutes. Threading an AbortSignal through all of those signatures
// would touch every scorer for one reason only: Cancel must stop what is
// already on the wire, not just what has not started yet.
//
// AsyncLocalStorage carries it instead. `runRegistry.startRun` opens the scope
// around a run's execution, and `fetchWithTimeout` reads it, so any outbound
// call made anywhere inside a run is aborted the moment Cancel is pressed.

import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<AbortSignal>();

/** Run ``fn`` (and everything it awaits) under ``signal``. */
export function withRunSignal<T>(signal: AbortSignal, fn: () => T): T {
  return store.run(signal, fn);
}

/** The enclosing run's signal, or undefined outside a run (a manual call). */
export function currentRunSignal(): AbortSignal | undefined {
  return store.getStore();
}
