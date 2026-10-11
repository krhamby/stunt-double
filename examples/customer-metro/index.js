// Bundle entry. A device app would call AppRegistry.registerComponent(...); this fixture exposes a render
// function so probes/render.mjs can evaluate the Metro bundle in Node and read the markers.
import { renderToString } from 'react-dom/server.browser';
import { createElement } from 'react';
import { App } from './src/App';

globalThis.__stuntDoubleRender = () => renderToString(createElement(App));
