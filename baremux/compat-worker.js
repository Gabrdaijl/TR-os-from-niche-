'use strict';

// Adapt BareMux's SharedWorker entry point to a transferable MessagePort so
// browsers without SharedWorker can run the same isolated transport worker.
importScripts('./worker.js');

const connect = self.onconnect;
self.onmessage = event => {
  if (event.data?.type !== 'tros-connect' || !event.ports?.[0]) return;
  if (typeof connect !== 'function') {
    event.ports[0].postMessage({ type: 'error', error: 'BareMux worker did not initialize.' });
    return;
  }
  connect({ ports: [event.ports[0]] });
};
