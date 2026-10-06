// Development entrypoint only. Production bundles server/index.ts directly.
import worker from './index';
export default {
  fetch(request: Request, env: Parameters<typeof worker.fetch>[1]) {
    const headers = new Headers(request.headers);
    headers.set('oai-authenticated-user-id', 'local-development');
    // Vite's local proxy preserves its Origin while forwarding to port 8787.
    if (headers.get('Origin') === 'http://localhost:5173' || headers.get('Origin') === 'http://127.0.0.1:5173') headers.set('Origin', new URL(request.url).origin);
    return worker.fetch(new Request(request, { headers }), env);
  },
};
