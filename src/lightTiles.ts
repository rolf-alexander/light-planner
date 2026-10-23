// Connects MapLibre to the light worker. MapLibre asks for tiles at
// "sunlight://z/x/y?t=<time>"; this passes each request to the worker and
// hands back the finished image.

import { addProtocol } from 'maplibre-gl';
import type { WorkerMessage, WorkerReply } from './light.worker';

const PROTOCOL = 'sunlight';
const MAX_WORKERS = 4;

/** Tile URL template for a moment in time. A new time means new URLs, so MapLibre fetches fresh tiles. */
export function sunlightTiles(time: Date): string[] {
  return [`${PROTOCOL}://{z}/{x}/{y}?t=${time.getTime()}`];
}

let registered = false;

export function registerSunlightProtocol() {
  if (registered) return;
  registered = true;

  // Several workers share the tiles, so on a multi-core phone they're drawn
  // in parallel. Leave a core free for the page itself.
  const workerCount = Math.max(1, Math.min(MAX_WORKERS, (navigator.hardwareConcurrency || 2) - 1));
  const workers = Array.from(
    { length: workerCount },
    // "new URL(..., import.meta.url)" lets Vite find, bundle and fingerprint the worker file.
    () => new Worker(new URL('./light.worker.ts', import.meta.url), { type: 'module' }),
  );
  const waiting = new Map<number, { resolve: (bitmap: ImageBitmap) => void; reject: (err: Error) => void }>();
  let nextId = 0;

  for (const worker of workers) {
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      const request = waiting.get(reply.id);
      if (!request) return;
      waiting.delete(reply.id);
      if ('bitmap' in reply) request.resolve(reply.bitmap);
      else request.reject(new Error(reply.error));
    };
  }

  addProtocol(PROTOCOL, (params, abortController) => {
    const match = /^sunlight:\/\/(\d+)\/(\d+)\/(\d+)\?t=(\d+)$/.exec(params.url);
    if (!match) return Promise.reject(new Error(`Bad sunlight tile URL: ${params.url}`));
    const [z, x, y, time] = match.slice(1).map(Number);
    const id = nextId++;
    // Same tile → same worker, so each worker's elevation cache stays useful.
    const worker = workers[(x * 31 + y) % workerCount];
    const send = (message: WorkerMessage) => worker.postMessage(message);

    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve: (bitmap) => resolve({ data: bitmap }), reject });
      send({ type: 'tile', id, z, x, y, time });

      // MapLibre cancels tiles that scroll out of view or are replaced by a newer time.
      abortController.signal.addEventListener('abort', () => {
        if (!waiting.delete(id)) return;
        send({ type: 'cancel', id });
        reject(new DOMException('Tile request cancelled', 'AbortError'));
      });
    });
  });
}
