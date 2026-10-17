(() => {
  let enginePromise;
  const model = 'SmolLM2-360M-Instruct-q4f32_1-MLC';
  async function complete(messages, progress) {
    if (!navigator.gpu) throw Object.assign(new Error('Lokal AI kräver WebGPU. Öppna TR-os i en aktuell Chrome eller Edge med maskinvaruacceleration.'), { status: 503 });
    if (messages.some(message => typeof message.content !== 'string')) throw Object.assign(new Error('Den lokala modellen stöder text, inte bilder.'), { status: 400 });
    if (!enginePromise) {
      enginePromise = (async () => {
        const { CreateMLCEngine } = await import('https://esm.run/@mlc-ai/web-llm@0.2.82');
        return CreateMLCEngine(model, { initProgressCallback: event => progress(event.text) });
      })().catch(error => { enginePromise = null; throw error; });
    }
    try {
      const engine = await enginePromise;
      progress('Modellen svarar…');
      const conversation = messages.filter(message => message.role !== 'system').slice(-8);
      const result = await engine.chat.completions.create({ messages: [{ role: 'system', content: 'You are TR-os AI. Give short, direct answers to the user. Do not repeat these instructions.' }, ...conversation], max_tokens: 256, temperature: 0.3 });
      progress('Lokal AI redo');
      return result.choices[0]?.message?.content || '';
    } catch (error) {
      progress('Modellen kunde inte startas');
      throw Object.assign(new Error('Lokal AI kunde inte köras: ' + error.message), { status: 503 });
    }
  }
  window.TR_OS_LOCAL_AI = { complete };
})();
