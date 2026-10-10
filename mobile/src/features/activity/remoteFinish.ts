/**
 * Lets something other than the record screen (the watch) finish the current
 * recording. The record screen registers itself so it can navigate to the
 * summary exactly as when the user finishes on the phone.
 */
type Handler = () => Promise<void>;

let handler: Handler | null = null;

export function registerRemoteFinish(h: Handler): () => void {
  handler = h;
  return () => {
    if (handler === h) handler = null;
  };
}

/** Returns false when no screen handled it (caller finishes on its own). */
export async function requestRemoteFinish(): Promise<boolean> {
  if (!handler) return false;
  await handler();
  return true;
}
