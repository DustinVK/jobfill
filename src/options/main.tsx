/** Options entrypoint: wires the real transport and mounts the app. */
import { render } from 'preact';
import { BrowserMessageTransport } from '../shared/adapters/browser.js';
import { ProtocolClient } from '../shared/messages.js';
import { App } from './App.js';

const root = document.getElementById('app');
if (root) render(<App client={new ProtocolClient(new BrowserMessageTransport())} />, root);
