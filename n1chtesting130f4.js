    (() => {
      const sel = document.getElementById('loc-picker');
      var RESI_ALIAS = { paloalto: 'mullvad-us', boston: 'mullvad-us', milan: 'mullvad-eu' };
      function cur() {
        var v = 'mullvad-eu';
        try { v = localStorage.getItem('tros-loc') || 'mullvad-eu'; } catch {}
        if (RESI_ALIAS[v]) { v = RESI_ALIAS[v]; try { localStorage.setItem('tros-loc', v); } catch (e) {} }
        return v;
      }
      var cv = cur();
      if (cv !== 'vps' && ['mullvad-us','mullvad-eu','mullvad-se'].indexOf(cv) === -1 && !/^[a-z]{2}-[a-z]{2,4}-wg-[0-9]+\.conf$/.test(cv)) { cv = 'mullvad-eu'; }
      sel.value = cv;
      async function mvLoadHome() {
        var data = null;
        try {
          var rr = await window.TR_OS.fetch('api/mullvad/relays');
          data = await rr.json();
        } catch (e) { return; }
        if (!data || !data.relays || !data.relays.length) return;
        var keep = null;
        try { keep = localStorage.getItem('tros-loc'); } catch (e2) {}
        sel.innerHTML = '';
        var vps = document.createElement('option');
        vps.value = 'vps';
        vps.textContent = 'VPS (direct)';
        sel.appendChild(vps);
        var groups = {};
        data.relays.forEach(function (rel) {
          var g = groups[rel.country];
          if (!g) { g = document.createElement('optgroup'); g.label = rel.country; groups[rel.country] = g; sel.appendChild(g); }
          var o = document.createElement('option');
          o.value = rel.id;
          o.textContent = rel.label;
          g.appendChild(o);
        });
        var want = keep;
        var okw = false;
        if (want) {
          for (var k = 0; k < sel.options.length; k++) { if (sel.options[k].value === want) { okw = true; break; } }
        }
        if (!okw) {
          want = (data.active && /^[a-z]{2}-[a-z]{2,4}-wg-[0-9]+\.conf$/.test(data.active)) ? data.active : sel.options[1].value;
          try { localStorage.setItem('tros-loc', want); } catch (e3) {}
        }
        sel.value = want;
        sel.title = 'Mullvad exit (shared by all users)';
      }
      if (window.TR_OS.vpnConfigured === false) {
        sel.innerHTML = '<option value="vps">Direct proxy</option>';
        try { localStorage.setItem('tros-loc', 'vps'); } catch (_) {}
      }
      mvLoadHome();
      try {
        if (window.self !== window.top && window.parent.document.getElementById('browser-input')) {
          document.getElementById('loc-picker').style.display = 'none';
        }
      } catch {}
      sel.addEventListener('change', () => {
        var v = sel.value;
        try { localStorage.setItem('tros-loc', v); } catch {}
        if (/^[a-z]{2}-[a-z]{2,4}-wg-[0-9]+\.conf$/.test(v)) {
          var st = document.getElementById('loc-status');
          if (st) { st.hidden = false; st.textContent = 'Switching Mullvad exit...'; }
          try { sel.disabled = true; } catch (e) {}
          window.TR_OS.fetch('api/mullvad/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: v }) }).then(function (r) { return r.json(); }).then(function (d) {
            if (d && d.ok) { location.reload(); }
            else {
              var st2 = document.getElementById('loc-status');
              if (st2) { st2.hidden = false; st2.textContent = 'Switch failed - try another exit'; }
              try { sel.disabled = false; } catch (e2) {}
            }
          }).catch(function () {
            var st3 = document.getElementById('loc-status');
            if (st3) { st3.hidden = false; st3.textContent = 'Switch failed - check connection, try again'; }
            try { sel.disabled = false; } catch (e3) {}
          });
        } else {
          location.reload();
        }
      });
    })();





  const testimonials = [
     {
      name: "z [WASM]",
      role: "Owner of Zodiac",
      msg: " “It is bad so it is good” ",
      pfp: "z.png"
    },
      {
      name: "ace [wasm]",
      role: "Owner of Helium",
      msg: " “TR-os is one of the greatest ubg sites i've ever seen.” ",
      pfp: "ace.png"
    },
     {
      name: "hvtrs",
      role: "Owner of Cherri & Breeze",
      msg: " “let's keep TR-os TR-os” ",
      pfp: "x8r.png"
    },
      {
      name: "midnight",
      role: "Owner of Nocturne",
      msg: " “im a gooner” ",
      pfp: "midnight.png"
    },
    {
      name: "Fig 🍓",
      role: "Owner of Figure",
      msg: " “World Cup everybody jump” ",
      pfp: "fig.png"
    },
    {
      name: "1y9r",
      role: "Owner of Novene",
      msg: " “aarush kamat cody impressed” ",
      pfp: "1y9r.png"
    },
      {
      name: "sols",
      role: "Owner of Chill zone",
      msg: "sols.png"
    },
    {
      name: "JustAOrange",
      role: "Owner of Nexora",
      msg: " “stay TR-os” ",
      pfp: "orange.png"
    },
    {
      name: "duderucool",
      role: "Owner of Flux",
      msg: " “TR-os looks like a TR-os site but good” ",
      pfp: "dudercool.png"
    },
     {
      name: "Mr Coffee",
      role: "Owner of Vanta",
      msg: " “I love TR-os because it is owned by my king ” ",
      pfp: "mrcoffee.png"
    },
     {
      name: "Zaka",
      role: "Owner of Zaka",
      msg: " “Welcome to TR-os” ",
      pfp: "zaka.png"
    },
     {
      name: "choose a name alr",
      role: "Owner of Abstract",
      msg: " “no” ",
      pfp: "abstract.webp"
    },

     {
      name: "DotLYHiyou",
      role: "Owner of DotGUI & close friend",
      msg: " “TR-os is the goat and my bestie” ",
      pfp: "c00l.png"
    },


  ];

  function makeCard(t) {
    let pfpHTML = '';
    if (t.pfp) {
      pfpHTML = `<img src="${t.pfp}" class="w-11.3 h-10 rounded-full object-cover flex-shrink-0" alt="${t.name}">`;
    } else {
      pfpHTML = `<div class="w-12 h-10 rounded-full bg-blue-200 flex-shrink-0 flex items-center justify-center text-sm font-bold text-blue-800">${t.name[0].toUpperCase()}</div>`;
    }

    return `
      <div class="mx-auto w-64 mt-3 rounded-2xl bg-blue-300 border-2 border-blue-400 flex gap-3 p-3 items-center justify-center flex-shrink-0">
        ${pfpHTML}
        <div class="flex flex-col min-w-0">
          <span class="text-xs font-semibold text-blue-900 truncate">${t.name}${t.role ? ' · ' + t.role : ''}</span>
          <span class="text-center text-sm text-blue-950">${t.msg}</span>
        </div>
      </div>
    `;
  }

  const track = document.getElementById('track');
  const all = [...testimonials, ...testimonials];
  track.innerHTML = all.map(makeCard).join('');
