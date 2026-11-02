// Recalculates automatically, 400 ms after the last edit, in a Web Worker. Results are cached by input,
// so switching AHUs or undoing an edit shows the earlier result at once without a rerun.
import { useEffect, useRef, useState } from "react";
import type { EngineLibraries, ProjectInput, ProjectResult } from "../engine/project";
import type { WorkerReply, WorkerRequest } from "./worker";

export interface RunState {
  result: ProjectResult | null;
  running: boolean;
  error: string | null;
  ms: number | null;
}

const DEBOUNCE_MS = 400;
const CACHE_SIZE = 12;

export function useRunner(libs: EngineLibraries | null, project: ProjectInput | null): RunState {
  const worker = useRef<Worker | null>(null);
  const cache = useRef(new Map<string, { result: ProjectResult; ms: number }>());
  const seq = useRef(0);
  const [state, setState] = useState<RunState>({ result: null, running: false, error: null, ms: null });

  useEffect(() => {
    const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    return () => w.terminate();
  }, []);

  useEffect(() => {
    if (libs) worker.current?.postMessage({ type: "libs", libs } satisfies WorkerRequest);
    cache.current.clear();
  }, [libs]);

  useEffect(() => {
    if (!libs || !project || !worker.current) {
      setState({ result: null, running: false, error: null, ms: null });
      return;
    }
    const key = JSON.stringify(project);
    const hit = cache.current.get(key);
    if (hit) {
      seq.current++;
      setState({ result: hit.result, running: false, error: null, ms: hit.ms });
      return;
    }
    setState((s) => ({ ...s, running: true }));
    const id = ++seq.current;
    const w = worker.current;
    const timer = setTimeout(() => {
      const onMsg = (e: MessageEvent<WorkerReply>) => {
        if (e.data.id !== id) return;
        w.removeEventListener("message", onMsg);
        if (id !== seq.current) return; // a newer edit is on its way
        if (e.data.ok) {
          cache.current.set(key, { result: e.data.result, ms: e.data.ms });
          if (cache.current.size > CACHE_SIZE) cache.current.delete(cache.current.keys().next().value!);
          setState({ result: e.data.result, running: false, error: null, ms: e.data.ms });
        } else {
          setState({ result: null, running: false, error: e.data.error, ms: null });
        }
      };
      w.addEventListener("message", onMsg);
      w.postMessage({ type: "run", id, project } satisfies WorkerRequest);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [libs, project]);

  return state;
}
