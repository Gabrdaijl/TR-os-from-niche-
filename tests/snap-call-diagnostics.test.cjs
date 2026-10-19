'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { MessageChannel, MessagePort } = require('node:worker_threads');
const root = path.resolve(__dirname, '..');
const engine = fs.readFileSync(path.join(root, 'snap-engine.js'), 'utf8');
const source = fs.readFileSync(path.join(root, 'snap-call-diagnostics.js'), 'utf8');

// Use the installed engine's real Tap API and its init.post hook contract.
function harness(options = {}) {
  class NoNetworkSocket extends EventTarget { static CLOSED = 3; static CONNECTING = 0; static OPEN = 1;
    constructor() { super(); throw new Error('Diagnostics cannot open a network connection'); }
  }
  const context = vm.createContext({
    URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, WebAssembly,
    EventTarget, Event, MessageEvent, Response, Request, Headers, ReadableStream, Blob,
    WebSocket: NoNetworkSocket, MessageChannel, MessagePort,
    WorkerGlobalScope: class {}, WorkerNavigator: class {}, WorkerLocation: URL,
    navigator: {}, location: new URL('https://tr-os.test/snapchat.html'),
    console, performance, atob, btoa, setTimeout, clearTimeout, setInterval, clearInterval,
    fetch() { throw new Error('Diagnostics cannot send a network request'); },
    importScripts() {}, postMessage() {}
  });
  vm.runInContext('globalThis.self = globalThis;', context);
  vm.runInContext(engine, context);
  vm.runInContext(source, context);
  const Tap = context.$scramjet.Tap;
  const frame = { hooks: { init: Tap.create() } }, events = [], mediaCalls = [], peerCalls = [];
  let nextPromise = Promise.resolve({ getTracks() { throw new Error('Streams must never be inspected'); } });
  class Devices {
    getUserMedia(...args) {
      if (!(this instanceof Devices)) throw new TypeError('Illegal invocation');
      mediaCalls.push({ receiver: this, args });
      if (options.mediaSyncError) throw options.mediaSyncError;
      return nextPromise;
    }
  }
  class Peer extends EventTarget {
    constructor(...args) {
      super();
      if (options.peerError) throw options.peerError;
      peerCalls.push({ args, newTarget: new.target });
      this.connectionState = 'new'; this.iceConnectionState = 'new';
      this.iceGatheringState = 'new'; this.signalingState = 'stable';
    }
    createOffer() { return options.offer; }
  }
  const scope = {
    Promise, EventTarget, RTCPeerConnection: Peer, MediaDevices: Devices,
    navigator: { mediaDevices: new Devices() }, isSecureContext: true,
    document: { permissionsPolicy: { allowsFeature(name) { return name === 'camera'; } } }
  };
  const media = Devices.prototype.getUserMedia;
  const helper = context.TR_OS_SNAP_CALLS;
  const reporter = options.reporter || (value => events.push(value));
  const fire = target => Tap.dispatch(frame.hooks.init.post, { window: target || scope }, {});
  return { helper, frame, events, scope, media, Peer, mediaCalls, peerCalls, fire,
    rejectMedia(error) { nextPromise = Promise.reject(error); return nextPromise; },
    get nativePromise() { return nextPromise; },
    install(enabled = true) { helper.install(frame, enabled, reporter); } };
}

test('call diagnostics are completely inactive without explicit opt-in', () => {
  const h = harness(); h.install(false); h.fire();
  assert.equal(h.scope.MediaDevices.prototype.getUserMedia, h.media);
  assert.equal(h.scope.RTCPeerConnection, h.Peer);
  assert.deepEqual(h.events, []);
});

test('actual init.post media observer retains receiver, exact arguments and original native promise', async () => {
  const h = harness(); h.install(); h.fire();
  let reads = 0;
  const constraints = { get audio() { reads++; throw new Error('PRIVATE_CONSTRAINT'); } };
  const devices = h.scope.navigator.mediaDevices;
  const promise = devices.getUserMedia(constraints);
  assert.equal(promise, h.nativePromise);
  await promise;
  assert.equal(reads, 0, 'The observer must never read constraints or device information');
  assert.equal(h.mediaCalls[0].receiver, devices);
  assert.equal(h.mediaCalls[0].args[0], constraints);
  assert.ok(h.events.some(event => event.area === 'media' && event.event === 'ready' && event.value === 'getUserMedia'));
  assert.throws(() => Reflect.apply(h.scope.MediaDevices.prototype.getUserMedia, {}, [constraints]), TypeError);
});

test('media permission failure preserves exact rejection and records only its fixed type', async () => {
  const h = harness(); h.install(); h.fire();
  const original = new DOMException('PRIVATE_DEVICE_AND_MESSAGE', 'NotAllowedError');
  const native = h.rejectMedia(original);
  const returned = h.scope.navigator.mediaDevices.getUserMedia({ audio: true });
  assert.equal(returned, native);
  await assert.rejects(returned, error => error === original);
  assert.ok(h.events.some(event => event.area === 'media' && event.event === 'error' && event.value === 'NotAllowedError'));
  assert.doesNotMatch(JSON.stringify(h.events), /PRIVATE|audio|deviceId|SDP|candidate/);
});

test('call state observer preserves constructor and RTC configuration without inspecting SDP or ICE', () => {
  const offer = { sdp: 'PRIVATE_SDP' }, h = harness({ offer });
  h.install(); h.fire();
  const config = { iceServers: [{ urls: 'turn:PRIVATE_IP', username: 'PRIVATE_USER', credential: 'PRIVATE_SECRET' }] };
  class SubPeer extends h.scope.RTCPeerConnection {}
  const peer = new SubPeer(config);
  assert.ok(peer instanceof h.Peer); assert.ok(peer instanceof h.scope.RTCPeerConnection);
  assert.equal(h.peerCalls[0].args[0], config); assert.equal(h.peerCalls[0].newTarget, SubPeer);
  assert.equal(peer.createOffer(), offer);
  peer.connectionState = 'failed'; peer.dispatchEvent(new Event('connectionstatechange'));
  peer.iceConnectionState = 'disconnected'; peer.dispatchEvent(new Event('iceconnectionstatechange'));
  peer.signalingState = 'have-local-offer'; peer.dispatchEvent(new Event('signalingstatechange'));
  peer.iceGatheringState = 'complete'; peer.dispatchEvent(new Event('icegatheringstatechange'));
  peer.connectionState = 'PRIVATE_STATE'; peer.dispatchEvent(new Event('connectionstatechange'));
  assert.deepEqual(h.events.filter(event => event.area === 'rtc').map(event => [event.event, event.value]), [
    ['created', 'new'], ['connection', 'failed'], ['ice', 'disconnected'],
    ['signaling', 'have-local-offer'], ['gathering', 'complete']
  ]);
  assert.doesNotMatch(JSON.stringify(h.events), /PRIVATE|sdp|credential|iceServers|candidate/);
});

test('diagnostic reporting errors, duplicate install and unavailable APIs cannot break call initialization', async () => {
  const h = harness({ reporter() { throw new Error('PRIVATE_REPORT_FAILURE'); } });
  h.install(); h.install(); h.fire();
  const wrapped = h.scope.RTCPeerConnection;
  h.fire(); assert.equal(h.scope.RTCPeerConnection, wrapped);
  await h.scope.navigator.mediaDevices.getUserMedia({ video: true });
  assert.doesNotThrow(() => new h.scope.RTCPeerConnection());
  assert.doesNotThrow(() => h.fire({ navigator: {}, document: {} }));
  assert.doesNotThrow(() => h.helper.install({}, true, () => {}));
  const rejected = new TypeError('PRIVATE_CONSTRUCTOR_FAILURE');
  const failed = harness({ peerError: rejected }); failed.install(); failed.fire();
  assert.throws(() => new failed.scope.RTCPeerConnection(), error => error === rejected);
});

test('capability reporting checks delegation without prompting for camera or microphone', () => {
  const h = harness(); h.install(); h.fire();
  assert.deepEqual(h.events.filter(event => event.area === 'capability').map(event => [event.event, event.value]), [
    ['secure', 'yes'], ['camera', 'yes'], ['microphone', 'no'], ['media', 'yes'], ['rtc', 'yes']
  ]);
  assert.deepEqual(h.mediaCalls, [], 'Opening help must never ask for media permission');
});
