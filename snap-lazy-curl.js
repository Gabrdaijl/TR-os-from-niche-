// Instantiate the 16 MiB socket WASM only when Snapchat actually opens a socket.
// Scramjet rejects application send() while CONNECTING; no payload queue is used.
(() => {
  const release = '20261022.1';
  function create(initialize) {
    let initializing;
    const client = () => {
      if (!initializing) {
        initializing = Promise.resolve().then(initialize).catch(error => {
          // A temporary WASM allocation failure must not poison every later
          // socket attempt for the lifetime of this Snapchat page.
          initializing = undefined;
          throw error;
        });
      }
      return initializing;
    };
    function connect(url, protocols, headers, open, data, close, error) {
      let phase = 'opening', callbacks, timer;
      const cleanup = () => clearTimeout(timer);
      const stop = (code, reason) => { try { Promise.resolve(callbacks?.[1](code, reason)).catch(() => {}); } catch {} };
      const fail = failure => {
        if (phase === 'failed' || phase === 'closed') return;
        if(phase==='open' || phase==='closing'){error(failure);return;}
        const wasOpening = phase === 'opening'; phase = 'failed'; cleanup();
        if (wasOpening) stop(1000, '');
        error(failure);
      };
      client().then(curl => {
        if (phase !== 'opening') return;
        timer = setTimeout(() => fail('Snapchat socket handshake timed out'), 15000);
        try {
          callbacks = curl.connect(url, protocols, headers,
            (...args) => { if (phase !== 'opening') { stop(1000,''); return; } phase = 'open'; cleanup(); open(...args); },
            (...args) => { if (phase === 'open') data(...args); },
            (...args) => {
              if (phase === 'opening') return fail('Snapchat socket closed before handshake');
              if (phase !== 'open' && phase !== 'closing') return;
              phase = 'closed'; cleanup(); close(...args);
            }, fail);
          if(phase==='failed' || phase==='closed')stop(1000,'');
        } catch (failure) { fail(failure); }
      }).catch(fail);
      return [value => {
        if (phase !== 'open') throw new Error('Socket is not open');
        return callbacks[0](value);
      }, (code = 1000, reason = '') => {
        if (phase === 'failed' || phase === 'closed' || phase === 'closing') return;
        if (phase === 'opening') { phase = 'closed'; cleanup(); stop(code,reason); close(code, reason); return; }
        phase = 'closing'; cleanup(); stop(code, reason);
      }];
    }
    return { client, connect };
  }
  window.TR_OS_SNAP_CURL = { release, create };
})();
