/* fleetlog-ai core logic — shared between Node (tests) and browser (via window.FleetLog).
   No dependencies. All logic is local; works fully offline. localStorage lives in js/app.js. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FleetLog = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DUE_SOON_DAYS = 30;       // time-based "due soon" threshold
  var DUE_SOON_MILES = 500;     // mileage-based "due soon" threshold
  var MAX_PHOTO_BYTES = 300 * 1024; // photo upload cap (300 KB)

  var TYPES = ['truck', 'van', 'car', 'trailer', 'equipment'];

  var SERVICE_TYPES = [
    { id: 'oil',          name: 'Oil change',   defaultMiles: 5000,  defaultMonths: 6  },
    { id: 'tires',        name: 'Tires',        defaultMiles: 60000, defaultMonths: 48 },
    { id: 'brakes',       name: 'Brakes',       defaultMiles: 30000, defaultMonths: 24 },
    { id: 'inspection',    name: 'Inspection',   defaultMiles: 0,     defaultMonths: 12 },
    { id: 'registration', name: 'Registration', defaultMiles: 0,     defaultMonths: 12 },
    { id: 'custom',       name: 'Custom',       defaultMiles: 0,     defaultMonths: 0  }
  ];

  function uid(prefix) {
    return (prefix || 'x') + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }

  function num(v, dflt) {
    var n = parseFloat(v);
    return (isNaN(n) ? (dflt || 0) : n);
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  function isoDay(d) { // 'YYYY-MM-DD' from a Date or ISO string
    if (typeof d === 'string') return d.slice(0, 10);
    var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  function addMonths(isoDate, months) {
    var p = isoDate.split('-');
    var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
    d.setMonth(d.getMonth() + months);
    return isoDay(d);
  }

  function daysBetween(aISO, bISO) { // b - a in whole days
    var a = new Date(aISO + 'T00:00:00'), b = new Date(bISO + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }

  // ---------- vehicles ----------
  function newVehicle(data) {
    data = data || {};
    return {
      id: uid('v'),
      name: String(data.name || '').trim(),
      type: TYPES.indexOf(data.type) >= 0 ? data.type : 'truck',
      year: data.year || '',
      make: String(data.make || '').trim(),
      model: String(data.model || '').trim(),
      vin: String(data.vin || '').trim(),
      plate: String(data.plate || '').trim(),
      photo: data.photo || '',
      fuel: [],      // {id, date, odo, gallons, pricePerGallon, cost, mpg}
      history: [],   // {id, date, odo, typeId, typeName, cost, notes}
      services: {},  // typeId -> {intervalMiles, intervalMonths, lastDate, lastOdo}
      created: isoDay(new Date())
    };
  }

  function labelFor(v) { // odometer label; equipment usually tracks hours
    return v && v.type === 'equipment' ? 'hours' : 'odometer';
  }

  // ---------- fuel ----------
  function fuelCost(entry) {
    return round2(num(entry.gallons) * num(entry.pricePerGallon));
  }

  // MPG for one fill-up: miles since previous fill-up divided by gallons.
  function mpgFor(prevOdo, odo, gallons) {
    var miles = num(odo) - num(prevOdo);
    var g = num(gallons);
    if (miles <= 0 || g <= 0) return null;
    return Math.round((miles / g) * 10) / 10;
  }

  function lastFuelEntry(vehicle) {
    var f = vehicle.fuel || [];
    return f.length ? f[f.length - 1] : null;
  }

  function currentReading(vehicle) {
    var max = 0;
    (vehicle.fuel || []).forEach(function (e) { if (num(e.odo) > max) max = num(e.odo); });
    (vehicle.history || []).forEach(function (e) { if (num(e.odo) > max) max = num(e.odo); });
    return max;
  }

  // Odometer must increase vs the last recorded reading (any source).
  function validateFuel(vehicle, entry) {
    if (!entry || num(entry.gallons) <= 0) return { ok: false, error: 'Enter gallons greater than zero.' };
    if (num(entry.pricePerGallon) < 0) return { ok: false, error: 'Price per gallon cannot be negative.' };
    var odo = num(entry.odo);
    if (odo <= 0) return { ok: false, error: 'Enter the ' + labelFor(vehicle) + ' reading.' };
    var prev = currentReading(vehicle);
    if (prev > 0 && odo <= prev) {
      return { ok: false, error: 'Reading must be greater than the last recorded ' +
        labelFor(vehicle) + ' reading of ' + prev + '.' };
    }
    return { ok: true, error: '' };
  }

  function addFuelEntry(vehicle, entry) {
    var check = validateFuel(vehicle, entry);
    if (!check.ok) return { ok: false, error: check.error };
    var prev = lastFuelEntry(vehicle);
    var e = {
      id: uid('f'),
      date: entry.date || isoDay(new Date()),
      odo: num(entry.odo),
      gallons: round2(num(entry.gallons)),
      pricePerGallon: round2(num(entry.pricePerGallon))
    };
    e.cost = fuelCost(e);
    e.mpg = prev ? mpgFor(prev.odo, e.odo, e.gallons) : null;
    vehicle.fuel = (vehicle.fuel || []).concat([e]);
    return { ok: true, error: '', entry: e };
  }

  // ---------- maintenance schedule ----------
  function serviceDef(typeId) {
    for (var i = 0; i < SERVICE_TYPES.length; i++) {
      if (SERVICE_TYPES[i].id === typeId) return SERVICE_TYPES[i];
    }
    return null;
  }

  // Merge defaults with any per-vehicle overrides; "custom" services carry their own name.
  function serviceConfig(vehicle, typeId) {
    var def = serviceDef(typeId) || serviceDef('custom');
    var saved = (vehicle.services || {})[typeId] || {};
    return {
      id: typeId,
      name: saved.name || def.name,
      intervalMiles: saved.intervalMiles != null ? saved.intervalMiles : def.defaultMiles,
      intervalMonths: saved.intervalMonths != null ? saved.intervalMonths : def.defaultMonths,
      lastDate: saved.lastDate || '',
      lastOdo: saved.lastOdo != null ? saved.lastOdo : null
    };
  }

  function serviceStatus(vehicle, typeId, nowISO) {
    nowISO = nowISO || isoDay(new Date());
    var cfg = serviceConfig(vehicle, typeId);
    var odo = currentReading(vehicle);
    var milesLeft = null, daysLeft = null;

    if (cfg.intervalMiles > 0 && cfg.lastOdo != null) {
      milesLeft = (cfg.lastOdo + cfg.intervalMiles) - odo;
    }
    if (cfg.intervalMonths > 0 && cfg.lastDate) {
      daysLeft = daysBetween(nowISO, addMonths(cfg.lastDate, cfg.intervalMonths));
    }

    var status = 'ok', reason = 'On schedule.';
    if (milesLeft == null && daysLeft == null) {
      status = 'unknown';
      reason = 'No service record yet — record one to start tracking.';
    } else if ((milesLeft != null && milesLeft <= 0) || (daysLeft != null && daysLeft <= 0)) {
      status = 'overdue';
      reason = milesLeft != null && milesLeft <= 0
        ? Math.abs(milesLeft) + ' ' + labelFor(vehicle) + ' past due.'
        : Math.abs(daysLeft) + ' days past due.';
    } else if ((milesLeft != null && milesLeft <= DUE_SOON_MILES) ||
               (daysLeft != null && daysLeft <= DUE_SOON_DAYS)) {
      status = 'due-soon';
      var bits = [];
      if (milesLeft != null && milesLeft <= DUE_SOON_MILES) bits.push(milesLeft + ' ' + labelFor(vehicle) + ' left');
      if (daysLeft != null && daysLeft <= DUE_SOON_DAYS) bits.push(daysLeft + ' days left');
      reason = 'Due soon — ' + bits.join(', ') + '.';
    }
    return { status: status, reason: reason, milesLeft: milesLeft, daysLeft: daysLeft, config: cfg };
  }

  // Services that appear for every vehicle (the 5 standard ones + any saved customs).
  function trackedServices(vehicle) {
    var ids = ['oil', 'tires', 'brakes', 'inspection', 'registration'];
    Object.keys(vehicle.services || {}).forEach(function (id) {
      if (ids.indexOf(id) < 0) ids.push(id);
    });
    return ids;
  }

  function needsAttention(vehicle, nowISO) {
    var out = [];
    trackedServices(vehicle).forEach(function (id) {
      var s = serviceStatus(vehicle, id, nowISO);
      if (s.status !== 'ok') out.push({ typeId: id, name: s.config.name, status: s.status, reason: s.reason,
        milesLeft: s.milesLeft, daysLeft: s.daysLeft });
    });
    return out;
  }

  function attentionCount(vehicles, nowISO) {
    var n = 0;
    (vehicles || []).forEach(function (v) {
      needsAttention(v, nowISO).forEach(function (a) { if (a.status === 'overdue' || a.status === 'due-soon') n++; });
    });
    return n;
  }

  function markServiceDone(vehicle, data) {
    data = data || {};
    var typeId = data.typeId || 'custom';
    var def = serviceDef(typeId);
    var cfg = serviceConfig(vehicle, typeId);
    var entry = {
      id: uid('s'),
      date: data.date || isoDay(new Date()),
      odo: num(data.odo) || 0,
      typeId: typeId,
      typeName: cfg.name,
      cost: round2(num(data.cost)),
      notes: String(data.notes || '').trim()
    };
    vehicle.history = (vehicle.history || []).concat([entry]);
    vehicle.services = vehicle.services || {};
    vehicle.services[typeId] = {
      name: cfg.name,
      intervalMiles: data.intervalMiles != null ? num(data.intervalMiles) : cfg.intervalMiles,
      intervalMonths: data.intervalMonths != null ? num(data.intervalMonths) : cfg.intervalMonths,
      lastDate: entry.date,
      lastOdo: entry.odo || null
    };
    return entry;
  }

  function vehicleTotals(vehicle) {
    var fuel = 0, maint = 0;
    (vehicle.fuel || []).forEach(function (e) { fuel += num(e.cost); });
    (vehicle.history || []).forEach(function (e) { maint += num(e.cost); });
    return { fuel: round2(fuel), maintenance: round2(maint), total: round2(fuel + maint) };
  }

  // ---------- cost per mile over a selectable period ----------
  function inRange(dateISO, startISO, endISO) {
    return (!startISO || dateISO >= startISO) && (!endISO || dateISO <= endISO);
  }

  function costPerMile(vehicle, startISO, endISO) {
    var fuelCostT = 0, maintCost = 0, odos = [], miles = 0, gallons = 0;
    (vehicle.fuel || []).forEach(function (e) {
      if (!inRange(e.date, startISO, endISO)) return;
      fuelCostT += num(e.cost);
      gallons += num(e.gallons);
      odos.push(num(e.odo));
    });
    (vehicle.history || []).forEach(function (e) {
      if (!inRange(e.date, startISO, endISO)) return;
      maintCost += num(e.cost);
    });
    if (odos.length >= 2) miles = Math.max.apply(null, odos) - Math.min.apply(null, odos);
    var total = round2(fuelCostT + maintCost);
    return {
      totalCost: total,
      fuelCost: round2(fuelCostT),
      maintCost: round2(maintCost),
      miles: round2(miles),
      costPerMile: miles > 0 ? Math.round((total / miles) * 1000) / 1000 : null,
      avgMpg: (miles > 0 && gallons > 0) ? Math.round((miles / gallons) * 10) / 10 : null
    };
  }

  // ---------- dashboard summary ----------
  function fleetSummary(vehicles, nowISO) {
    nowISO = nowISO || isoDay(new Date());
    var yearStart = nowISO.slice(0, 4) + '-01-01';
    var spend = 0, miles = 0, gallons = 0;
    (vehicles || []).forEach(function (v) {
      (v.fuel || []).forEach(function (e) {
        if (e.date >= yearStart) spend += num(e.cost);
        gallons += num(e.gallons);
      });
      (v.history || []).forEach(function (e) { if (e.date >= yearStart) spend += num(e.cost); });
      var o = (v.fuel || []).map(function (e) { return num(e.odo); });
      if (o.length >= 2) miles += Math.max.apply(null, o) - Math.min.apply(null, o);
    });
    return {
      count: (vehicles || []).length,
      spendThisYear: round2(spend),
      attention: attentionCount(vehicles, nowISO),
      avgMpg: (miles > 0 && gallons > 0) ? Math.round((miles / gallons) * 10) / 10 : null
    };
  }

  // ---------- photo upload helper ----------
  function checkPhotoSize(dataUrl) {
    var bytes = 0;
    if (typeof dataUrl === 'string' && dataUrl.indexOf('base64,') >= 0) {
      bytes = Math.round((dataUrl.length - dataUrl.indexOf('base64,') - 7) * 0.75);
    }
    return { ok: bytes <= MAX_PHOTO_BYTES, bytes: bytes, maxBytes: MAX_PHOTO_BYTES };
  }

  // ---------- fuel entry management: delete, sort, CSV ----------
  function deleteFuelEntry(vehicle, entryId) {
    var before = (vehicle.fuel || []).length;
    vehicle.fuel = (vehicle.fuel || []).filter(function (e) { return e.id !== entryId; });
    return vehicle.fuel.length < before;
  }

  function sortFuel(vehicle, field, dir) {
    field = ['date', 'mpg', 'cost', 'gallons'].indexOf(field) >= 0 ? field : 'date';
    dir = dir === 'asc' ? 1 : -1;
    return (vehicle.fuel || []).slice().sort(function (a, b) {
      var av = a[field], bv = b[field];
      if (av == null) return 1;   // nulls (e.g. no-mpg first fill) always last
      if (bv == null) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }

  // MPG anomalies: a fill-up whose MPG is >20% below the average of the
  // previous 3 fill-ups with MPG data (possible fuel waste / siphoning).
  // Returns { entryId: { mpg, avg, dropPct } }.
  function mpgAnomalies(vehicle) {
    var out = {};
    var withMpg = (vehicle.fuel || []).filter(function (e) { return e.mpg != null; });
    withMpg.forEach(function (e, i) {
      var prev = withMpg.slice(Math.max(0, i - 3), i);
      if (prev.length < 2) return;
      var avg = prev.reduce(function (s, x) { return s + x.mpg; }, 0) / prev.length;
      if (avg > 0 && e.mpg < avg * 0.8) {
        out[e.id] = { mpg: e.mpg, avg: Math.round(avg * 10) / 10,
          dropPct: Math.round((1 - e.mpg / avg) * 100) };
      }
    });
    return out;
  }

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function fuelToCSV(vehicle) {
    var rows = [['date', 'odometer', 'gallons', 'price_per_gallon', 'cost', 'mpg']];
    (vehicle.fuel || []).forEach(function (e) {
      rows.push([csvCell(e.date), csvCell(e.odo), csvCell(e.gallons),
        csvCell(e.pricePerGallon), csvCell(e.cost), csvCell(e.mpg == null ? '' : e.mpg)]);
    });
    return rows.map(function (r) { return r.join(','); }).join('\n');
  }

  function serviceToCSV(vehicle) {
    var rows = [['date', 'service', 'odometer', 'cost', 'notes']];
    (vehicle.history || []).forEach(function (e) {
      rows.push([csvCell(e.date), csvCell(e.typeName), csvCell(e.odo),
        csvCell(e.cost), csvCell(e.notes || '')]);
    });
    return rows.map(function (r) { return r.join(','); }).join('\n');
  }

  // ---------- dashboard search ----------
  function filterVehicles(vehicles, query) {
    var q = String(query || '').toLowerCase().trim();
    if (!q) return (vehicles || []).slice();
    return (vehicles || []).filter(function (v) {
      var hay = [v.name, v.make, v.model, v.plate, v.vin, v.type].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  // ---------- friendly "AI-style" summary (local templates, no API) ----------
  function attentionBlurb(vehicle, nowISO) {
    var a = needsAttention(vehicle, nowISO);
    if (!a.length) return vehicle.name + ' is fully on schedule — nothing needs attention.';
    var over = a.filter(function (x) { return x.status === 'overdue'; }).length;
    var soon = a.filter(function (x) { return x.status === 'due-soon'; }).length;
    var bits = [];
    if (over) bits.push(over + ' overdue');
    if (soon) bits.push(soon + ' due soon');
    return vehicle.name + ' needs attention: ' + bits.join(' and ') + '. ' +
      a.slice(0, 2).map(function (x) { return x.name + ': ' + x.reason; }).join(' ');
  }

  // Optional OpenAI polish — never required; pure enhancement hook.
  function polishWithOpenAI(text, apiKey) {
    return new Promise(function (resolve) {
      if (!apiKey || typeof fetch === 'undefined') { resolve({ polished: false, text: text }); return; }
      resolve({ polished: false, text: text }); // hook: wire real call when key present
    });
  }

  return {
    DUE_SOON_DAYS: DUE_SOON_DAYS,
    DUE_SOON_MILES: DUE_SOON_MILES,
    MAX_PHOTO_BYTES: MAX_PHOTO_BYTES,
    TYPES: TYPES,
    SERVICE_TYPES: SERVICE_TYPES,
    newVehicle: newVehicle,
    labelFor: labelFor,
    fuelCost: fuelCost,
    mpgFor: mpgFor,
    currentReading: currentReading,
    validateFuel: validateFuel,
    addFuelEntry: addFuelEntry,
    serviceConfig: serviceConfig,
    serviceStatus: serviceStatus,
    trackedServices: trackedServices,
    needsAttention: needsAttention,
    attentionCount: attentionCount,
    markServiceDone: markServiceDone,
    vehicleTotals: vehicleTotals,
    costPerMile: costPerMile,
    fleetSummary: fleetSummary,
    checkPhotoSize: checkPhotoSize,
    attentionBlurb: attentionBlurb,
    deleteFuelEntry: deleteFuelEntry,
    sortFuel: sortFuel,
    mpgAnomalies: mpgAnomalies,
    fuelToCSV: fuelToCSV,
    serviceToCSV: serviceToCSV,
    filterVehicles: filterVehicles,
    polishWithOpenAI: polishWithOpenAI,
    isoDay: isoDay,
    addMonths: addMonths
  };
}));
