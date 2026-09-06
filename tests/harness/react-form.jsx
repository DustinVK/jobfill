/**
 * React 18 CONTROLLED form harness (bundled real React, never shipped). The rendered
 * state mirror (`#state-mirror`) is what tests assert — proving React's own state updated,
 * not just the input's value attribute.
 */
import { createRoot } from 'react-dom/client';
import { useState } from 'react';

function App() {
  const [values, setValues] = useState({ firstName: '', lastName: '', email: '', summary: '' });
  const set = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }));

  return (
    <form>
      <label htmlFor="r-first">First name</label>
      <input id="r-first" value={values.firstName} onChange={set('firstName')} />
      <label htmlFor="r-last">Last name</label>
      <input id="r-last" value={values.lastName} onChange={set('lastName')} />
      <label htmlFor="r-email">Email</label>
      <input id="r-email" type="email" value={values.email} onChange={set('email')} />
      <label htmlFor="r-summary">Describe your responsibilities</label>
      <textarea id="r-summary" rows={5} value={values.summary} onChange={set('summary')} />
      <pre id="state-mirror" data-testid="state-mirror">
        {JSON.stringify(values)}
      </pre>
    </form>
  );
}

createRoot(document.getElementById('react-root')).render(<App />);
