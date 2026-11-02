// Runs the engine off the page thread: the 12-month RTS sweep takes long enough to freeze typing.
import type { EngineLibraries, ProjectInput, ProjectResult } from "../engine/project";
import { runProject } from "../engine/project";

export type WorkerRequest = { type: "libs"; libs: EngineLibraries } | { type: "run"; id: number; project: ProjectInput };
export type WorkerReply = { id: number; ok: true; result: ProjectResult; ms: number } | { id: number; ok: false; error: string };

const ctx = self as unknown as { onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null; postMessage(m: WorkerReply): void };
let libs: EngineLibraries | null = null;

ctx.onmessage = (e) => {
  const m = e.data;
  if (m.type === "libs") {
    libs = m.libs;
    return;
  }
  if (!libs) return ctx.postMessage({ id: m.id, ok: false, error: "Libraries not loaded." });
  const t0 = performance.now();
  try {
    const result = runProject(m.project, libs);
    ctx.postMessage({ id: m.id, ok: true, result, ms: performance.now() - t0 });
  } catch (err) {
    ctx.postMessage({ id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
