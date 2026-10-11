// Server-render <App/> through the hooks and print the render markers (same contract as customer-vite's probe).
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

const { App } = await import('../src/App.tsx');
const html = renderToString(createElement(App));
const section = (name) => html.split(`data-probe="${name}"`)[1]?.split('</section>')[0] ?? '';
const markers = (s) => [...s.matchAll(/data-sd="([A-Z0-9_]+)"(?: data-ctx="([^"]*)")?/g)].map((m) => (m[2] ? `${m[1]}(${m[2]})` : m[1]));
console.log(`app: ${markers(section('app')).join(' > ')}`);
console.log(`sdk: ${markers(section('sdk')).join(', ')}`);
console.log('STUNT-DOUBLE-RENDER ' + JSON.stringify(html));
