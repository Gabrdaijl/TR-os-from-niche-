// Opt-in, device-local call diagnostics. Native media/WebRTC routing, arguments,
// return values and errors are preserved. No media, device IDs, SDP or network
// addresses are read or recorded.
(function (global) {
  'use strict';
  const release = '20261022.7';
  const frames = new WeakSet(), windows = new WeakSet();
  const errors = new Set(['NotAllowedError', 'NotFoundError', 'NotReadableError',
    'OverconstrainedError', 'AbortError', 'InvalidStateError', 'SecurityError',
    'TypeError', 'NotSupportedError']);
  const states = {
    connection: new Set(['new', 'connecting', 'connected', 'disconnected', 'failed', 'closed']),
    ice: new Set(['new', 'checking', 'connected', 'completed', 'disconnected', 'failed', 'closed']),
    signaling: new Set(['stable', 'have-local-offer', 'have-remote-offer',
      'have-local-pranswer', 'have-remote-pranswer', 'closed']),
    gathering: new Set(['new', 'gathering', 'complete'])
  };

  function attach(scope, report) {
    if (!scope || windows.has(scope)) return;
    windows.add(scope);
    const emit = (area, event, value) => { try { report({ area, event, value }); } catch {} };
    const failure = error => {
      let name;
      try { name = error?.name; } catch {}
      return errors.has(name) ? name : 'Other';
    };
    const capability = (event, value) => emit('capability', event,
      typeof value === 'boolean' ? (value ? 'yes' : 'no') : 'unknown');
    capability('secure', scope.isSecureContext);
    let policy;
    try { policy = scope.document?.permissionsPolicy || scope.document?.featurePolicy; } catch {}
    for (const name of ['camera', 'microphone']) {
      let allowed;
      try { allowed = policy?.allowsFeature(name); } catch {}
      capability(name, allowed);
    }

    let devices;
    try { devices = scope.navigator?.mediaDevices; } catch {}
    const mediaOwner = scope.MediaDevices?.prototype || devices;
    const media = mediaOwner?.getUserMedia;
    capability('media', typeof media === 'function');
    if (typeof media === 'function') {
      const descriptor = Object.getOwnPropertyDescriptor(mediaOwner, 'getUserMedia');
      const wrapped = new Proxy(media, {
        apply(target, receiver, args) {
          // Do not read constraints: a caller may supply getters, and observing
          // those a second time would change the native method's behavior.
          emit('media', 'request', 'getUserMedia');
          let result;
          try { result = Reflect.apply(target, receiver, args); }
          catch (error) { emit('media', 'error', failure(error)); throw error; }
          // Return the exact native promise so callers retain native semantics.
          // Observation is optional and cannot replace a failed or successful call.
          try {
            scope.Promise.prototype.then.call(result,
              () => emit('media', 'ready', 'getUserMedia'),
              error => emit('media', 'error', failure(error)));
          } catch {}
          return result;
        }
      });
      try { Object.defineProperty(mediaOwner, 'getUserMedia', { ...descriptor, value: wrapped }); } catch {}
    }

    const NativePeer = scope.RTCPeerConnection;
    capability('rtc', typeof NativePeer === 'function');
    if (typeof NativePeer !== 'function') return;
    const descriptor = Object.getOwnPropertyDescriptor(scope, 'RTCPeerConnection');
    const wrapped = new Proxy(NativePeer, {
      construct(target, args, newTarget) {
        const peer = Reflect.construct(target, args, newTarget);
        emit('rtc', 'created', 'new');
        for (const [event, property, change] of [
          ['connection', 'connectionState', 'connectionstatechange'],
          ['ice', 'iceConnectionState', 'iceconnectionstatechange'],
          ['signaling', 'signalingState', 'signalingstatechange'],
          ['gathering', 'iceGatheringState', 'icegatheringstatechange']
        ]) {
          const observe = () => {
            let value;
            try { value = peer[property]; } catch {}
            if (states[event].has(value)) emit('rtc', event, value);
          };
          try { scope.EventTarget.prototype.addEventListener.call(peer, change, observe); } catch {}
        }
        return peer;
      }
    });
    try { Object.defineProperty(scope, 'RTCPeerConnection', { ...descriptor, value: wrapped }); } catch {}
  }

  function install(frame, enabled, report) {
    if (!enabled || typeof report !== 'function' || !frame?.hooks?.init?.post || frames.has(frame)) return;
    if (typeof global.$scramjet?.Tap?.tap !== 'function') return;
    global.$scramjet.Tap.tap(frame.hooks.init.post, event => {
      try { attach(event.window, report); } catch {}
    });
    frames.add(frame);
  }
  global.TR_OS_SNAP_CALLS = Object.freeze({ release, install });
})(globalThis);
