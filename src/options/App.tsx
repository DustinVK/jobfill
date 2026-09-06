import { useEffect, useState } from 'preact/hooks';
import type { ProtocolClient } from '../shared/messages.js';

export function App({ client }: { client: ProtocolClient }) {
  const [status, setStatus] = useState('connecting…');

  useEffect(() => {
    client
      .send({ t: 'ping' })
      .then((r) => setStatus(`background v${r.version} connected`))
      .catch((e: unknown) => setStatus(`disconnected: ${String(e)}`));
  }, [client]);

  return (
    <main>
      <h1>jobfill</h1>
      <p class="subtitle">Local-only resume storage and application autofill.</p>
      <div class="panel">
        <strong>Status:</strong> {status}
      </div>
    </main>
  );
}
