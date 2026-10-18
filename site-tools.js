(() => {
  const $ = id => document.getElementById(id);
  const fullscreen = $('site-fullscreen'), dialog = $('report-dialog'), form = $('report-form');
  const status = $('site-tools-status'), result = $('report-result');
  const labels = {'n1browser27d.html':'browser','n1chetesting2.html':'games','nm.html':'movies','nai.html':'ai','launcher.html':'cloud'};
  let selectedImage = '', imageTask = null, imageVersion = 0, imageError = '', sending = false, submissionId = '';
  const uuid = () => { try { if(typeof crypto!=='undefined' && crypto.randomUUID)return crypto.randomUUID(); } catch {} return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, value=>{const n=Math.floor(Math.random()*16);return(value==='x'?n:(n&3)|8).toString(16);}); };
  const clientId = (() => { try { let value = localStorage.getItem('tros-report-client'); if (!/^[a-f0-9-]{36}$/i.test(value || '')) { value = uuid(); localStorage.setItem('tros-report-client',value); } return value; } catch { return uuid(); } })();
  function syncFullscreen() {
    const active = !!document.fullscreenElement;
    fullscreen.setAttribute('aria-pressed',String(active));
    fullscreen.setAttribute('aria-label',active?'Avsluta fullskärm':'Fullskärm');
    fullscreen.title = active?'Avsluta fullskärm (Esc)':'Fullskärm';
  }
  fullscreen.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else throw Error();
      status.textContent='';
    } catch { status.textContent='Webbläsaren kunde inte starta fullskärm. Prova F11.'; }
    syncFullscreen();
  });
  document.addEventListener('fullscreenchange',syncFullscreen);syncFullscreen();
  document.addEventListener('keydown',event=>{if(event.key==='Escape' && document.fullscreenElement===document.documentElement && !dialog.open)document.exitFullscreen().catch(()=>{});});
  $('site-report').addEventListener('click', () => {
    if(!$('report-message').value.trim() && !submissionId && !selectedImage){try { const file = new URL($('mainFrame').src,location.href).pathname.split('/').pop(); $('report-category').value=labels[file] || 'other'; } catch { $('report-category').value='other'; }}
    dialog.showModal();
  });
  $('report-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{$('site-report').focus();});
  function show(message,error=false) { result.textContent=message;result.dataset.error=String(error); }
  async function compress(file) {
    if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(file.type) || file.size>12*1024*1024) throw Error('Välj en vanlig bildfil på högst 12 MB.');
    let bitmap;
    try {
      bitmap=await createImageBitmap(file);
      if (!bitmap.width || !bitmap.height || bitmap.width*bitmap.height>40000000) throw Error('Bilden är för stor.');
      const ratio=Math.min(1,1280/bitmap.width,1280/bitmap.height), canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
      const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
      for (const quality of [.82,.65,.45]) { const encoded=canvas.toDataURL('image/jpeg',quality); if (encoded.length<=136556) return encoded; }
      canvas.width=Math.max(1,Math.round(canvas.width*.6));canvas.height=Math.max(1,Math.round(canvas.height*.6));
      const small=canvas.getContext('2d');small.fillStyle='#fff';small.fillRect(0,0,canvas.width,canvas.height);small.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const encoded=canvas.toDataURL('image/jpeg',.6);if(encoded.length>136556)throw Error('Bilden är för detaljerad. Välj en mindre bild.');return encoded;
    } finally { bitmap?.close(); }
  }
  $('report-image').addEventListener('change', () => {
    const version=++imageVersion, file=$('report-image').files[0];submissionId='';selectedImage='';imageError='';$('report-preview').hidden=true;
    if (!file) {imageTask=null;return;}
    show('Förbereder bilden…');
    imageTask=compress(file).then(image=>{if(version!==imageVersion)return;selectedImage=image;$('report-preview').src=image;$('report-preview').hidden=false;show('Bilden är klar.');})
      .catch(error=>{if(version===imageVersion){imageError=error.message;$('report-image').value='';show(error.message,true);}});
  });
  $('report-remove-image').addEventListener('click',()=>{submissionId='';imageVersion++;imageTask=null;selectedImage='';imageError='';$('report-image').value='';$('report-preview').removeAttribute('src');$('report-preview').hidden=true;show('');});
  form.addEventListener('input',()=>{if(!sending)submissionId='';});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(sending)return;sending=true;
    const controls=Array.from(form.querySelectorAll('input,textarea,select,button'));controls.forEach(control=>{control.disabled=true;});
    try {
      if(imageTask)await imageTask;
      if(imageError)throw Error(imageError);
      const message=$('report-message').value.trim();if(message.length<5)throw Error('Beskriv felet med minst fem tecken.');
      show('Skickar rapporten…');
      submissionId ||= uuid();
      const response=await fetch('/api/reports',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message,category:$('report-category').value,image:selectedImage,clientId,requestId:submissionId}),signal:AbortSignal.timeout(12000)});
      const data=await response.json();if(!response.ok)throw Error(data.error || 'Rapporten kunde inte skickas.');
      form.reset();submissionId='';imageVersion++;imageTask=null;selectedImage='';$('report-preview').removeAttribute('src');$('report-preview').hidden=true;show('Tack! Rapporten har skickats till TR-os admin.');
    } catch(error) {show(error.name==='TimeoutError'?'Det tog för lång tid. Försök igen.':error.message,true);}
    finally {sending=false;controls.forEach(control=>{control.disabled=false;});}
  });
})();
