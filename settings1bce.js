(function () {
  var THEMES = [
    { id: 'dark', name: 'Dark', dots: ['#000000', '#111111', '#ffffff'] },
    { id: 'halloween', name: 'Ember', dots: ['#0a0705', '#120c07', '#d99a5f'] },
    { id: 'red', name: 'Crimson', dots: ['#0d0807', '#150c0a', '#d67f6d'] },
    { id: 'green', name: 'Moss', dots: ['#070a07', '#0c110b', '#a3b18a'] },
    { id: 'white', name: 'White', dots: ['#f4f1ea', '#ffffff', '#2f5d8a'] },
    { id: 'ocean', name: 'Ocean Blue', dots: ['#060b10', '#0a1218', '#5aa9e6'] }
  ];
  var CLOAKS = [
    { id: 'classroom', name: 'Google Classroom', title: 'Home - Classroom', icon: 'https://www.gstatic.com/classroom/ic_product_classroom_32.png' },
    { id: 'docs', name: 'Google Docs', title: 'Google Docs', icon: 'https://docs.google.com/favicon.ico' },
    { id: 'drive', name: 'Google Drive', title: 'Home - Google Drive', icon: 'https://drive.google.com/favicon.ico' }
  ];

  function current() {
    try {
      if (typeof window.trosGetTheme === 'function') return window.trosGetTheme();
      return localStorage.getItem('tros-theme') || 'dark';
    } catch (e) { return 'dark'; }
  }

  function pick(id) {
    try {
      if (typeof window.trosSetTheme === 'function') window.trosSetTheme(id);
      else {
        localStorage.setItem('tros-theme', id);
        localStorage.setItem('tros-dark', '1');
        location.reload();
      }
    } catch (e) {}
    renderThemes();
  }

  function renderThemes() {
    var cur = current();
    var pill = document.getElementById('settings-current');
    if (pill) pill.textContent = cur;
    var box = document.getElementById('theme-list');
    if (!box) return;
    box.innerHTML = '';
    THEMES.forEach(function (th) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pill' + (th.id === cur ? ' on' : '');
      th.dots.forEach(function (c) {
        var d = document.createElement('span');
        d.className = 'dot';
        d.style.background = c;
        b.appendChild(d);
      });
      var t = document.createElement('span');
      t.textContent = th.name;
      b.appendChild(t);
      b.addEventListener('click', function () { pick(th.id); });
      box.appendChild(b);
    });
  }

  function getCloak() {
    try {
      var v = JSON.parse(localStorage.getItem('tros-cloak') || 'null');
      if (v && typeof v === 'object') return v;
    } catch (e) {}
    return null;
  }

  function applyCloak(c) {
    if (c && c.title) document.title = c.title;
    var link = document.querySelector('link[rel="icon"]');
    if (c && c.icon) {
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = c.icon;
    } else if (link) link.removeAttribute('href');
  }

  function saveCloak(c) {
    try {
      if (c) localStorage.setItem('tros-cloak', JSON.stringify(c));
      else localStorage.removeItem('tros-cloak');
    } catch (e) {}
    applyCloak(c);
    renderCloaks();
  }

  function renderCloaks() {
    var cur = getCloak();
    var box = document.getElementById('cloak-list');
    if (!box) return;
    box.innerHTML = '';
    CLOAKS.forEach(function (cl) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pill' + (cur && cur.id === cl.id ? ' on' : '');
      if (cl.icon) {
        var im = document.createElement('img');
        im.className = 'dot';
        im.src = cl.icon;
        im.alt = '';
        b.appendChild(im);
      } else {
        var dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = '#7585f5';
        b.appendChild(dot);
      }
      var t = document.createElement('span');
      t.textContent = cl.name;
      b.appendChild(t);
      b.addEventListener('click', function () {
        saveCloak({ id: cl.id, title: cl.title, icon: cl.icon });
      });
      box.appendChild(b);
    });
    if (cur && !cur.id) {
      var titleInput = document.getElementById('cloak-title');
      var iconInput = document.getElementById('cloak-icon');
      if (titleInput) titleInput.value = cur.title || '';
      if (iconInput) iconInput.value = cur.icon || '';
    }
  }

  function refreshWallpaper() {
    var data = null;
    try {
      if (typeof window.trosGetWallpaper === 'function') data = window.trosGetWallpaper();
      else data = localStorage.getItem('tros-wallpaper');
    } catch (e) {}
    var img = document.getElementById('wallpaper-preview');
    var st = document.getElementById('wallpaper-status');
    if (data && img) {
      img.src = data;
      img.style.display = 'block';
    } else if (img) {
      img.style.display = 'none';
    }
    if (st) st.textContent = data ? 'Custom wallpaper saved.' : 'No custom wallpaper set.';
  }

  function storeDirect(url) {
    try {
      localStorage.setItem('tros-wallpaper', url);
    } catch (e) {
      return false;
    }
    try {
      if (typeof window.trosSetWallpaper === 'function') window.trosSetWallpaper(url);
    } catch (e2) {}
    return true;
  }

  function saveWallpaper(dataUrl) {
    if (!storeDirect(dataUrl)) {
      var st = document.getElementById('wallpaper-status');
      if (st) st.textContent = 'Image too large to save.';
      return;
    }
    refreshWallpaper();
  }

  function switchPane(name) {
    document.querySelectorAll('#sbar button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-pane') === name);
    });
    document.querySelectorAll('#smain section').forEach(function (sec) {
      sec.hidden = sec.getAttribute('data-pane') !== name;
    });
  }

  function readImageFile(file) {
    return new Promise(function (resolve, reject) {
      var rd = new FileReader();
      rd.onload = function () { resolve(rd.result); };
      rd.onerror = reject;
      rd.readAsDataURL(file);
    });
  }

  function shrinkImage(src, maxSize, quality) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        try {
          var scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          var w = Math.max(1, Math.round(img.width * scale));
          var h = Math.max(1, Math.round(img.height * scale));
          var cv = document.createElement('canvas');
          cv.width = w;
          cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve({ url: cv.toDataURL('image/jpeg', quality), w: w, h: h });
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  async function handleWallpaperFile(file) {
    var original = await readImageFile(file).catch(function () { return null; });
    if (!original) return;
    if (storeDirect(original)) {
      setStatus('Custom wallpaper saved (original quality).');
      refreshWallpaper();
      return;
    }
    var steps = [[2560, 0.9], [1920, 0.82], [1280, 0.75]];
    for (var i = 0; i < steps.length; i++) {
      try {
        var out = await shrinkImage(original, steps[i][0], steps[i][1]);
        if (!storeDirect(out.url)) continue;
        setStatus('Custom wallpaper saved (' + out.w + 'x' + out.h + ').');
        refreshWallpaper();
        return;
      } catch (err) {}
    }
    saveWallpaper(original);
  }

  function setStatus(text) {
    var st = document.getElementById('wallpaper-status');
    if (st) st.textContent = text;
  }

  document.querySelectorAll('#sbar button').forEach(function (b) {
    b.addEventListener('click', function () {
      switchPane(b.getAttribute('data-pane'));
    });
  });

  document.getElementById('cloak-save').addEventListener('click', function () {
    var title = document.getElementById('cloak-title').value.trim();
    var icon = document.getElementById('cloak-icon').value.trim();
    if (!title && !icon) return;
    saveCloak({ id: null, title: title || document.title, icon: icon || null });
  });

  document.getElementById('cloak-reset').addEventListener('click', function () {
    document.title = 'Tr-os Settings';
    var link = document.querySelector('link[rel="icon"]');
    if (link) link.removeAttribute('href');
    try {
      document.getElementById('cloak-title').value = '';
      document.getElementById('cloak-icon').value = '';
    } catch (e) {}
    saveCloak(null);
  });

  document.getElementById('wallpaper-file').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    handleWallpaperFile(f);
    e.target.value = '';
  });

  document.getElementById('wallpaper-remove').addEventListener('click', function () {
    try {
      if (typeof window.trosClearWallpaper === 'function') window.trosClearWallpaper();
      else localStorage.removeItem('tros-wallpaper');
    } catch (e) {}
    refreshWallpaper();
  });


  function fmtKey(c) {
    if (!c || !c.key) return 'No key set';
    var parts = [];
    if (c.ctrl) parts.push('Ctrl');
    if (c.shift) parts.push('Shift');
    if (c.alt) parts.push('Alt');
    if (c.meta) parts.push('Cmd');
    parts.push(c.key.length === 1 ? c.key.toUpperCase() : c.key);
    return parts.join(' + ');
  }

  function getPanic() {
    try {
      var v = JSON.parse(localStorage.getItem('tros-panic') || 'null');
      if (v && typeof v === 'object' && v.key && v.url) return v;
    } catch (e) {}
    return null;
  }

  function refreshPanic() {
    var cur = getPanic();
    var label = document.getElementById('panic-key-label');
    if (label) label.textContent = fmtKey(cur);
    var urlInput = document.getElementById('panic-url');
    if (urlInput && cur && !urlInput.value) urlInput.value = cur.url;
  }

  var pendingRec = null;

  document.getElementById('panic-record').addEventListener('click', function () {
    pendingRec = true;
    var label = document.getElementById('panic-key-label');
    if (label) label.textContent = 'Press any key...';
  });

  document.addEventListener('keydown', function (e) {
    if (!pendingRec) return;
    e.preventDefault();
    e.stopPropagation();
    pendingRec = false;
    var urlInput = document.getElementById('panic-url');
    pendingRec = {
      key: e.key || '',
      ctrl: !!e.ctrlKey,
      shift: !!e.shiftKey,
      alt: !!e.altKey,
      meta: !!e.metaKey,
      url: urlInput ? urlInput.value.trim() : ''
    };
    var old = getPanic();
    if (old && old.url && !pendingRec.url) pendingRec.url = old.url;
    var label = document.getElementById('panic-key-label');
    if (label) label.textContent = fmtKey(pendingRec);
  }, true);

  document.getElementById('panic-save').addEventListener('click', function () {
    var urlInput = document.getElementById('panic-url');
    var url = urlInput ? urlInput.value.trim() : '';
    if (pendingRec) pendingRec.url = url;
    if (!pendingRec || !pendingRec.key || !url) return;
    try {
      localStorage.setItem('tros-panic', JSON.stringify(pendingRec));
    } catch (e) {}
    pendingRec = null;
    refreshPanic();
  });

  document.getElementById('panic-url').addEventListener('focus', function () {
    if (!pendingRec) return;
    pendingRec = null;
    refreshPanic();
  });

  document.getElementById('panic-clear').addEventListener('click', function () {
    try {
      localStorage.removeItem('tros-panic');
      localStorage.removeItem('tros-panic-pending');
      var urlInput = document.getElementById('panic-url');
      if (urlInput) urlInput.value = '';
    } catch (e) {}
    refreshPanic();
  });

  refreshPanic();
  applyCloak(getCloak());
  renderThemes();
  renderCloaks();
  refreshWallpaper();
})();
