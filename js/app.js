/* fleetlog-ai UI — localStorage persistence, no network, works offline. */
(function () {
  'use strict';
  var F = window.FleetLog;
  var LS_KEY = 'fleetlog.vehicles.v1';

  function load() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; }
  }
  function save(v) { localStorage.setItem(LS_KEY, JSON.stringify(v)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return '$' + (Math.round(n * 100) / 100).toFixed(2); }
  function todayISO() { return F.isoDay(new Date()); }
  function getVehicle(id) {
    var found = null;
    load().forEach(function (v) { if (v.id === id) found = v; });
    return found;
  }
  function upsert(v) {
    var list = load(), done = false;
    list = list.map(function (x) { if (x.id === v.id) { done = true; return v; } return x; });
    if (!done) list.push(v);
    save(list);
  }

  // ---------- nav ----------
  document.querySelectorAll('.topbar nav button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.topbar nav button').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      document.querySelectorAll('.view').forEach(function (v) { v.classList.add('hidden'); });
      document.getElementById('view-' + b.dataset.view).classList.remove('hidden');
      if (b.dataset.view === 'dashboard') renderDashboard();
      if (b.dataset.view === 'vehicles') renderVehList();
      if (b.dataset.view === 'fuel') renderFuel();
      if (b.dataset.view === 'maintenance') renderMaintenance();
    });
  });

  function flagFor(status) {
    var map = { overdue: ['red', 'OVERDUE'], 'due-soon': ['yellow', 'DUE SOON'], ok: ['green', 'OK'], unknown: ['gray', 'SET UP'] };
    var m = map[status] || map.ok;
    return '<span class="flag ' + m[0] + '">' + m[1] + '</span>';
  }

  // ---------- dashboard ----------
  var fleetSearchQuery = '';
  document.getElementById('fleetSearch').addEventListener('input', function (e) {
    fleetSearchQuery = e.target.value;
    renderDashboard();
  });

  function renderDashboard() {
    var list = load(), now = todayISO();
    var s = F.fleetSummary(list, now);
    document.getElementById('stCount').textContent = s.count;
    document.getElementById('stSpend').textContent = money(s.spendThisYear);
    document.getElementById('stAttention').textContent = s.attention;
    document.getElementById('stMpg').textContent = s.avgMpg == null ? '—' : s.avgMpg;

    var alerts = [];
    list.forEach(function (v) {
      F.needsAttention(v, now).forEach(function (a) {
        if (a.status === 'overdue' || a.status === 'due-soon') {
          alerts.push({ vehicle: v, a: a });
        }
      });
    });
    var ab = document.getElementById('alertList');
    if (!list.length) { ab.innerHTML = '<p class="muted">Add a vehicle to start tracking maintenance.</p>'; }
    else if (!alerts.length) { ab.innerHTML = '<p class="muted">All vehicles on schedule. 🎉</p>'; }
    else {
      ab.innerHTML = '';
      alerts.forEach(function (x) {
        var row = document.createElement('div');
        row.className = 'alert-row';
        row.innerHTML = '<div><strong>' + esc(x.vehicle.name) + '</strong> — ' + esc(x.a.name) +
          '<div class="small muted">' + esc(x.a.reason) + '</div></div>' + flagFor(x.a.status);
        ab.appendChild(row);
      });
    }

    var cards = document.getElementById('fleetCards');
    var visible = F.filterVehicles(list, fleetSearchQuery);
    if (!list.length) { cards.innerHTML = '<p class="muted">No vehicles yet — add your first under the Vehicles tab.</p>'; }
    else if (!visible.length) { cards.innerHTML = '<p class="muted">No vehicles match "' + esc(fleetSearchQuery) + '".</p>'; }
    else {
      cards.innerHTML = '';
      visible.forEach(function (v) {
        var t = F.vehicleTotals(v);
        var att = F.needsAttention(v, now).filter(function (a) { return a.status !== 'ok'; }).length;
        var div = document.createElement('div');
        div.className = 'vrow';
        div.innerHTML =
          (v.photo ? '<img src="' + v.photo + '" alt="photo of ' + esc(v.name) + '">' : '') +
          '<div class="meta"><div class="nm">' + esc(v.name) + '</div>' +
          '<div class="sub">' + esc([v.year, v.make, v.model].filter(Boolean).join(' ')) +
          ' · ' + esc(v.type) + ' · ' + money(t.total) + ' total spend</div></div>' +
          (att ? '<span class="flag yellow">' + att + ' to check</span>' : '<span class="flag green">OK</span>');
        cards.appendChild(div);
      });
    }
  }

  // ---------- vehicles ----------
  var photoData = '';
  document.getElementById('vPhoto').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    var note = document.getElementById('vPhotoNote'), prev = document.getElementById('vPhotoPreview');
    photoData = ''; note.classList.add('hidden'); prev.classList.add('hidden');
    if (!file) return;
    var r = new FileReader();
    r.onload = function () {
      var url = r.result, check = F.checkPhotoSize(url);
      if (!check.ok) {
        note.textContent = 'That photo is ' + Math.round(check.bytes / 1024) +
          ' KB — over the ' + Math.round(check.maxBytes / 1024) +
          ' KB cap. It was not saved; try a smaller image.';
        note.classList.remove('hidden');
        e.target.value = '';
        return;
      }
      photoData = url;
      prev.src = url; prev.classList.remove('hidden');
    };
    r.readAsDataURL(file);
  });

  document.getElementById('saveVehicle').addEventListener('click', function () {
    var name = document.getElementById('vName').value.trim();
    if (!name) { alert('Give the vehicle a name first.'); return; }
    var v = F.newVehicle({
      name: name,
      type: document.getElementById('vType').value,
      year: document.getElementById('vYear').value.trim(),
      make: document.getElementById('vMake').value.trim(),
      model: document.getElementById('vModel').value.trim(),
      vin: document.getElementById('vVin').value.trim(),
      plate: document.getElementById('vPlate').value.trim(),
      photo: photoData
    });
    upsert(v);
    photoData = '';
    document.getElementById('vName').value = '';
    document.getElementById('vYear').value = '';
    document.getElementById('vMake').value = '';
    document.getElementById('vModel').value = '';
    document.getElementById('vVin').value = '';
    document.getElementById('vPlate').value = '';
    document.getElementById('vPhoto').value = '';
    document.getElementById('vPhotoPreview').classList.add('hidden');
    document.getElementById('vPhotoNote').classList.add('hidden');
    renderVehList();
  });

  function renderVehList() {
    var list = load();
    var box = document.getElementById('vehList');
    if (!list.length) { box.innerHTML = '<p class="muted">No vehicles yet — add your first above.</p>'; return; }
    box.innerHTML = '';
    list.forEach(function (v) {
      var t = F.vehicleTotals(v);
      var div = document.createElement('div');
      div.className = 'vrow';
      div.innerHTML =
        (v.photo ? '<img src="' + v.photo + '" alt="photo of ' + esc(v.name) + '">' : '') +
        '<div class="meta"><div class="nm">' + esc(v.name) + '</div>' +
        '<div class="sub">' + esc([v.year, v.make, v.model, v.type].filter(Boolean).join(' · ')) +
        (v.plate ? ' · plate ' + esc(v.plate) : '') + ' · ' + money(t.total) + ' spend</div></div>' +
        '<div class="acts"><button class="icon-btn" data-del="' + v.id + '">Delete</button></div>';
      div.querySelector('[data-del]').addEventListener('click', function () {
        if (!confirm('Delete ' + v.name + ' and all its logs?')) return;
        save(load().filter(function (x) { return x.id !== v.id; }));
        renderVehList();
      });
      box.appendChild(div);
    });
  }

  // ---------- fuel ----------
  function fillVehicleSelects() {
    var list = load();
    [['fVehicle', false], ['fHistVehicle', true], ['mVehicle', false]].forEach(function (pair) {
      var sel = document.getElementById(pair[0]);
      var cur = sel.value;
      sel.innerHTML = '';
      if (pair[1]) { var o = document.createElement('option'); o.value = ''; o.textContent = 'Select a vehicle…'; sel.appendChild(o); }
      list.forEach(function (v) {
        var opt = document.createElement('option');
        opt.value = v.id; opt.textContent = v.name;
        sel.appendChild(opt);
      });
      if (cur) sel.value = cur;
      if (!sel.value && list.length && !pair[1]) sel.value = list[0].id;
    });
  }

  function updateCostPreview() {
    var g = parseFloat(document.getElementById('fGal').value) || 0;
    var p = parseFloat(document.getElementById('fPrice').value) || 0;
    document.getElementById('fCostPreview').textContent = money(F.fuelCost({ gallons: g, pricePerGallon: p }));
  }
  ['fGal', 'fPrice'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', updateCostPreview);
  });

  document.getElementById('fVehicle').addEventListener('change', function () {
    var v = getVehicle(this.value);
    document.getElementById('fOdoLabel').textContent = v ? (F.labelFor(v) === 'hours' ? 'Hours' : 'Odometer') : 'Odometer';
  });

  document.getElementById('saveFuel').addEventListener('click', function () {
    var id = document.getElementById('fVehicle').value;
    var v = getVehicle(id);
    if (!v) { alert('Add a vehicle first.'); return; }
    var res = F.addFuelEntry(v, {
      date: document.getElementById('fDate').value || todayISO(),
      odo: document.getElementById('fOdo').value,
      gallons: document.getElementById('fGal').value,
      pricePerGallon: document.getElementById('fPrice').value
    });
    if (!res.ok) { alert(res.error); return; }
    upsert(v);
    document.getElementById('fOdo').value = '';
    document.getElementById('fGal').value = '';
    document.getElementById('fPrice').value = '';
    updateCostPreview();
    var hs = document.getElementById('fHistVehicle');
    hs.value = id;
    renderFuelHistory(id);
    alert('Saved — ' + money(res.entry.cost) + (res.entry.mpg != null ? ' · ' + res.entry.mpg + ' MPG' : ''));
  });

  document.getElementById('fHistVehicle').addEventListener('change', function () {
    fuelSort = 'date'; fuelSortDir = 'desc';
    var sel = document.getElementById('fuelSort');
    if (sel) sel.value = 'date-desc';
    renderFuelHistory(this.value);
  });

  var fuelSort = 'date', fuelSortDir = 'desc';

  function renderFuelHistory(id) {
    var box = document.getElementById('fuelList');
    var v = id ? getVehicle(id) : null;
    if (!v) { box.innerHTML = '<p class="muted">Select a vehicle to see its fuel log.</p>'; return; }
    if (!v.fuel.length) { box.innerHTML = '<p class="muted">No fill-ups logged yet for ' + esc(v.name) + '.</p>'; return; }
    var anomalies = F.mpgAnomalies(v);
    var rows = F.sortFuel(v, fuelSort, fuelSortDir).map(function (e) {
      var an = anomalies[e.id];
      return '<tr><td>' + esc(e.date) + '</td><td>' + esc(e.odo) + '</td><td>' + esc(e.gallons) +
        '</td><td>' + money(e.pricePerGallon) + '</td><td>' + money(e.cost) + '</td><td>' +
        (e.mpg == null ? '—' : e.mpg) +
        (an ? ' <span class="anom" title="MPG ' + an.dropPct + '% below recent average (' + an.avg + ') — possible fuel waste">⚠ low</span>' : '') +
        '</td><td><button class="link danger-link" data-delfuel="' + e.id + '">delete</button></td></tr>';
    }).join('');
    box.innerHTML =
      '<div class="hist-toolbar"><label class="muted small">Sort <select id="fuelSort">' +
      [['date-desc', 'Newest first'], ['date-asc', 'Oldest first'], ['mpg-desc', 'Best MPG'], ['mpg-asc', 'Worst MPG'],
       ['cost-desc', 'Highest cost'], ['cost-asc', 'Lowest cost']].map(function (o) {
        return '<option value="' + o[0] + '"' + ((fuelSort + '-' + fuelSortDir) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></label>' +
      '<button class="ghost" id="exportFuel">Export fuel CSV</button></div>' +
      '<table class="data"><tr><th>Date</th><th>Reading</th><th>Gal</th><th>$/gal</th><th>Cost</th><th>MPG</th><th></th></tr>' +
      rows + '</table>';
    document.getElementById('fuelSort').addEventListener('change', function () {
      var parts = this.value.split('-');
      fuelSort = parts[0]; fuelSortDir = parts[1];
      renderFuelHistory(id);
    });
    box.querySelectorAll('[data-delfuel]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!confirm('Delete this fill-up? MPG numbers for later fill-ups will shift.')) return;
        var vv = getVehicle(id);
        F.deleteFuelEntry(vv, b.getAttribute('data-delfuel'));
        // recompute MPG for entries after the deletion (their "previous" fill-up changed)
        vv.fuel.forEach(function (e, i) {
          var prev = i > 0 ? vv.fuel[i - 1] : null;
          e.mpg = prev ? F.mpgFor(prev.odo, e.odo, e.gallons) : null;
        });
        upsert(vv);
        renderFuelHistory(id);
      });
    });
    document.getElementById('exportFuel').addEventListener('click', function () {
      downloadCSV(F.fuelToCSV(getVehicle(id)), v.name.replace(/[^a-z0-9]+/gi, '-') + '-fuel.csv');
    });
  }

  function downloadCSV(csv, filename) {
    var blob = new Blob([csv], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  function renderFuel() {
    fillVehicleSelects();
    var v = getVehicle(document.getElementById('fVehicle').value);
    document.getElementById('fOdoLabel').textContent = v && F.labelFor(v) === 'hours' ? 'Hours' : 'Odometer';
    if (!document.getElementById('fDate').value) document.getElementById('fDate').value = todayISO();
    updateCostPreview();
    var hid = document.getElementById('fHistVehicle').value;
    renderFuelHistory(hid || (v ? v.id : ''));
    if (!hid && v) document.getElementById('fHistVehicle').value = v.id;
  }

  // ---------- maintenance ----------
  function renderMaintenance() {
    fillVehicleSelects();
    var id = document.getElementById('mVehicle').value;
    var v = id ? getVehicle(id) : null;
    if (!v) {
      document.getElementById('svcTable').innerHTML = '<p class="muted">Add a vehicle first.</p>';
      document.getElementById('svcHistory').innerHTML = '';
      return;
    }
    document.getElementById('sOdoLabel').textContent = F.labelFor(v) === 'hours' ? 'Hours' : 'Odometer';
    if (!document.getElementById('sDate').value) document.getElementById('sDate').value = todayISO();

    // service type select
    var st = document.getElementById('sType'), cur = st.value;
    st.innerHTML = '';
    F.trackedServices(v).forEach(function (tid) {
      var cfg = F.serviceConfig(v, tid);
      var opt = document.createElement('option');
      opt.value = tid; opt.textContent = cfg.name;
      st.appendChild(opt);
    });
    var copt = document.createElement('option');
    copt.value = '__new__'; copt.textContent = '+ Add custom service…';
    st.appendChild(copt);
    if (cur && Array.prototype.some.call(st.options, function (o) { return o.value === cur; })) st.value = cur;

    // schedule table
    var now = todayISO();
    var rows = F.trackedServices(v).map(function (tid) {
      var s = F.serviceStatus(v, tid, now), c = s.config;
      return '<tr><td><strong>' + esc(c.name) + '</strong><div class="small muted">' + esc(s.reason) + '</div></td>' +
        '<td><input type="number" min="0" step="100" data-im="' + tid + '" value="' + esc(c.intervalMiles || 0) + '" style="width:90px"></td>' +
        '<td><input type="number" min="0" step="1" data-imo="' + tid + '" value="' + esc(c.intervalMonths || 0) + '" style="width:70px"></td>' +
        '<td>' + flagFor(s.status) + '</td></tr>';
    }).join('');
    document.getElementById('svcTable').innerHTML =
      '<table class="data"><tr><th>Service</th><th>Every (mi/hr)</th><th>Every (mo)</th><th>Status</th></tr>' +
      rows + '</table><button id="saveIntervals" class="ghost">Save intervals</button>';
    document.getElementById('saveIntervals').addEventListener('click', function () {
      v.services = v.services || {};
      F.trackedServices(v).forEach(function (tid) {
        var im = document.querySelector('[data-im="' + tid + '"]');
        var imo = document.querySelector('[data-imo="' + tid + '"]');
        var cfg = F.serviceConfig(v, tid);
        v.services[tid] = {
          name: cfg.name,
          intervalMiles: parseFloat(im.value) || 0,
          intervalMonths: parseFloat(imo.value) || 0,
          lastDate: cfg.lastDate || '',
          lastOdo: cfg.lastOdo
        };
      });
      upsert(v);
      renderMaintenance();
      alert('Intervals saved.');
    });

    // history
    var hb = document.getElementById('svcHistory');
    var hist = (v.history || []).slice().reverse();
    hb.innerHTML = '<h3>Service history</h3>' +
      (hist.length ? '<div class="hist-toolbar"><button class="ghost" id="exportSvc">Export service CSV</button></div>' +
        '<table class="data"><tr><th>Date</th><th>Service</th><th>Reading</th><th>Cost</th><th>Notes</th></tr>' +
        hist.map(function (e) {
          return '<tr><td>' + esc(e.date) + '</td><td>' + esc(e.typeName) + '</td><td>' + esc(e.odo || '—') +
            '</td><td>' + money(e.cost) + '</td><td>' + esc(e.notes || '') + '</td></tr>';
        }).join('') + '</table>'
        : '<p class="muted">No service records yet.</p>');
    var exBtn = document.getElementById('exportSvc');
    if (exBtn) exBtn.addEventListener('click', function () {
      downloadCSV(F.serviceToCSV(v), v.name.replace(/[^a-z0-9]+/gi, '-') + '-service.csv');
    });
  }

  document.getElementById('mVehicle').addEventListener('change', renderMaintenance);

  document.getElementById('sType').addEventListener('change', function () {
    if (this.value === '__new__') {
      var name = prompt('Name for the custom service (e.g. "Hydraulic flush"):');
      if (!name) { this.value = F.trackedServices(getVehicle(document.getElementById('mVehicle').value))[0] || 'oil'; return; }
      var v = getVehicle(document.getElementById('mVehicle').value);
      var tid = 'custom-' + Date.now().toString(36);
      v.services = v.services || {};
      v.services[tid] = { name: name.trim(), intervalMiles: 0, intervalMonths: 0, lastDate: '', lastOdo: null };
      upsert(v);
      renderMaintenance();
      document.getElementById('sType').value = tid;
    }
  });

  document.getElementById('saveService').addEventListener('click', function () {
    var id = document.getElementById('mVehicle').value;
    var v = getVehicle(id);
    if (!v) { alert('Add a vehicle first.'); return; }
    var tid = document.getElementById('sType').value;
    if (tid === '__new__') { alert('Pick a service first.'); return; }
    F.markServiceDone(v, {
      typeId: tid,
      date: document.getElementById('sDate').value || todayISO(),
      odo: document.getElementById('sOdo').value,
      cost: document.getElementById('sCost').value,
      notes: document.getElementById('sNotes').value
    });
    upsert(v);
    document.getElementById('sOdo').value = '';
    document.getElementById('sCost').value = '';
    document.getElementById('sNotes').value = '';
    renderMaintenance();
    alert('Service recorded.');
  });

  document.getElementById('calcCpm').addEventListener('click', function () {
    var id = document.getElementById('mVehicle').value;
    var v = getVehicle(id);
    var box = document.getElementById('cpmResult');
    if (!v) { box.innerHTML = '<p class="muted">Add a vehicle first.</p>'; return; }
    var period = document.getElementById('cpmPeriod').value;
    var now = todayISO(), start = null;
    if (period === '30' || period === '90' || period === '365') {
      var d = new Date(); d.setDate(d.getDate() - parseInt(period, 10));
      start = F.isoDay(d);
    } else if (period === 'ytd') { start = now.slice(0, 4) + '-01-01'; }
    var r = F.costPerMile(v, start, now);
    box.innerHTML = r.costPerMile == null
      ? '<p class="muted">Not enough data for this period — log at least two fill-ups with readings.</p>'
      : '<div class="big-result">' + money(r.costPerMile) + '<span class="small muted"> / mile</span></div>' +
        '<p class="muted">' + esc(v.name) + ' · ' + esc(r.miles) + ' miles · ' +
        money(r.fuelCost) + ' fuel + ' + money(r.maintCost) + ' maintenance = ' + money(r.totalCost) +
        (r.avgMpg != null ? ' · ' + r.avgMpg + ' MPG' : '') + '</p>';
  });

  // ---------- init ----------
  fillVehicleSelects();
  renderDashboard();
  renderVehList();
})();
