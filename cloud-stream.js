(function (root) {
  async function readSessionStream(response, onMessage, signal) {
    if (!response.body) throw new Error('Cloud response has no stream');
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let pending = '';
    async function consume(line) {
      line = line.trim().replace(/^data:\s*/, '');
      if (!line || line === '[DONE]') return null;
      let message;
      try { message = JSON.parse(line); } catch { return null; }
      await onMessage(message);
      return ['queue', 'finished_queue', 'error'].includes(message.status) ? message.status : null;
    }
    try {
      while (true) {
        if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        const { value, done } = await reader.read();
        pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
        let split;
        while ((split = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, split); pending = pending.slice(split + 1);
          const status = await consume(line);
          if (status) return status;
        }
        if (done) return await consume(pending);
      }
    } finally { await reader.cancel().catch(() => {}); }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { readSessionStream };
  else root.TR_OS_CLOUD = { readSessionStream };
})(typeof window !== 'undefined' ? window : globalThis);
