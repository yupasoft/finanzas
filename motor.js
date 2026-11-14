/* =====================================================================
   YUPAFINANZAS · motor de cálculo (sin pantalla, sin red)
   Fechas siempre como texto 'AAAA-MM-DD'. Dinero en céntimos enteros por dentro
   para que 0.10 + 0.20 no dé 0.30000000000000004.
   Se usa en el navegador (window.FinMotor) y en las pruebas (require).
   ===================================================================== */
(function (raiz) {
  'use strict';
  var DIA = 86400000;
  function num(f) { var p = f.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / DIA; }
  function txt(n) { var d = new Date(n * DIA); return d.getUTCFullYear() + '-' + dos(d.getUTCMonth() + 1) + '-' + dos(d.getUTCDate()); }
  function dos(n) { return (n < 10 ? '0' : '') + n; }
  function diasMes(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }      // m: 1..12
  function fechaDe(y, m, d) { return y + '-' + dos(m) + '-' + dos(Math.min(d, diasMes(y, m))); }
  function finMes(y, m) { return fechaDe(y, m, 31); }
  function sumarDias(f, n) { return txt(num(f) + n); }
  function cent(v) { return Math.round(Number(v || 0) * 100); }

  var PASO_MESES = { mensual: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 };
  var PASO_DIAS = { semanal: 7, bisemanal: 14 };

  /* Fechas en que cae una partida entre "desde" y "hasta" (los dos incluidos) */
  function fechas(p, desde, hasta) {
    var r = [];
    if (!p || p.activo === false || !p.fecha) return r;
    var ini = p.fecha, fin = p.fecha_fin && p.fecha_fin < hasta ? p.fecha_fin : hasta;
    if (desde < ini) desde = ini;
    if (desde > fin) return r;
    var f = p.frecuencia || 'unico', y, m, k, d, x;
    if (f === 'unico') { if (ini >= desde && ini <= fin) r.push(ini); return r; }
    if (PASO_DIAS[f]) {
      var paso = PASO_DIAS[f], n0 = num(ini), nd = num(desde), nf = num(fin);
      k = Math.max(0, Math.ceil((nd - n0) / paso));
      for (x = n0 + k * paso; x <= nf; x += paso) r.push(txt(x));
      return r;
    }
    y = +desde.slice(0, 4); m = +desde.slice(5, 7);
    if (f === 'quincenal') {                      // el 15 y el último día de cada mes
      for (;;) {
        x = fechaDe(y, m, 15); if (x > fin) break; if (x >= desde) r.push(x);
        x = finMes(y, m); if (x > fin) break; if (x >= desde) r.push(x);
        m++; if (m > 12) { m = 1; y++; }
      }
      return r;
    }
    var pm = PASO_MESES[f]; if (!pm) return r;
    var y0 = +ini.slice(0, 4), m0 = +ini.slice(5, 7); d = +ini.slice(8, 10);   // día 31 → último día del mes
    k = Math.max(0, Math.floor(((y - y0) * 12 + (m - m0)) / pm));
    for (;; k++) {
      var t = (m0 - 1) + k * pm; x = fechaDe(y0 + Math.floor(t / 12), (t % 12) + 1, d);
      if (x > fin) break; if (x >= desde) r.push(x);
    }
    return r;
  }

  /* Todas las ocurrencias de un rango, con lo que se anotó de cada una.
     ocus: mapa "partida_id|fecha" → {hecho, hecho_el, monto, omitida} */
  function eventos(partidas, ocus, desde, hasta) {
    var r = [];
    (partidas || []).forEach(function (p) {
      fechas(p, desde, hasta).forEach(function (f) {
        var o = (ocus && ocus[p.id + '|' + f]) || {};
        var c = o.monto === null || o.monto === undefined ? cent(p.monto) : cent(o.monto);
        r.push({ p: p, fecha: f, cent: c, signo: p.tipo === 'ingreso' ? 1 : -1, hecho: !!o.hecho, hecho_el: o.hecho_el || null, omitida: !!o.omitida, cambiado: o.monto !== null && o.monto !== undefined });
      });
    });
    r.sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : (b.signo - a.signo) || (a.p.nombre < b.p.nombre ? -1 : 1); });
    return r;
  }

  /* ¿Este movimiento cambia el saldo que se proyecta?
     Sí, si cae el día del saldo de partida o después, no está omitido y no se marcó
     como hecho ANTES de fijar el saldo (en ese caso ya está dentro del saldo). */
  function cuenta(cfg, e) {
    if (e.omitida || e.fecha < cfg.fecha_inicial) return false;
    if (e.hecho && e.hecho_el && cfg.saldo_fijado_el && Date.parse(e.hecho_el) <= Date.parse(cfg.saldo_fijado_el)) return false;
    return true;
  }

  /* Dinero que queda al terminar un día. null si es antes del saldo de partida. */
  function saldoAl(cfg, partidas, ocus, fecha) {
    if (fecha < cfg.fecha_inicial) return null;
    var s = cent(cfg.saldo_inicial);
    eventos(partidas, ocus, cfg.fecha_inicial, fecha).forEach(function (e) { if (cuenta(cfg, e)) s += e.signo * e.cent; });
    return s / 100;
  }

  /* Quincenas (1–15 y 16–fin) de n meses desde (y, m), acumuladas.
     Cada una: {y, m, q, desde, hasta, antes, base, ingresos, gastos, saldo} en soles. */
  function periodos(cfg, partidas, ocus, y, m, n) {
    var cortes = [], i, yy = y, mm = m;
    for (i = 0; i < n; i++) {
      cortes.push({ y: yy, m: mm, q: 1, desde: fechaDe(yy, mm, 1), hasta: fechaDe(yy, mm, 15) });
      cortes.push({ y: yy, m: mm, q: 2, desde: fechaDe(yy, mm, 16), hasta: finMes(yy, mm) });
      mm++; if (mm > 12) { mm = 1; yy++; }
    }
    var fi = cfg.fecha_inicial, ult = cortes[cortes.length - 1].hasta;
    var ev = ult >= fi ? eventos(partidas, ocus, fi, ult).filter(function (e) { return cuenta(cfg, e); }) : [];
    var s = cent(cfg.saldo_inicial), j = 0;
    cortes.forEach(function (c) {
      if (c.hasta < fi) { c.antes = true; c.base = c.ingresos = c.gastos = c.saldo = null; return; }
      for (; j < ev.length && ev[j].fecha < c.desde; j++) s += ev[j].signo * ev[j].cent;
      var ing = 0, gas = 0, base = s;
      for (; j < ev.length && ev[j].fecha <= c.hasta; j++) { if (ev[j].signo > 0) ing += ev[j].cent; else gas += ev[j].cent; }
      s = base + ing - gas;
      c.antes = false; c.parcial = fi > c.desde; c.base = base / 100; c.ingresos = ing / 100; c.gastos = gas / 100; c.saldo = s / 100;
    });
    return cortes;
  }

  /* Total de las cuentas en cada fecha con registro (cada cuenta arrastra su último saldo conocido) */
  function serieCuentas(cuentas, saldos) {
    var ids = {}, porFecha = {}, ult = {}, r = [];
    (cuentas || []).forEach(function (c) { if (!c.archivada) ids[c.id] = 1; });
    (saldos || []).forEach(function (s) { if (ids[s.cuenta_id]) (porFecha[s.fecha] = porFecha[s.fecha] || []).push(s); });
    Object.keys(porFecha).sort().forEach(function (f) {
      porFecha[f].forEach(function (s) { ult[s.cuenta_id] = cent(s.monto); });
      var t = 0, k; for (k in ult) t += ult[k];
      r.push({ fecha: f, total: t / 100 });
    });
    return r;
  }

  /* Saldos de una cuenta, del más antiguo al más nuevo */
  function serieCuenta(saldos, id) {
    return (saldos || []).filter(function (s) { return s.cuenta_id === id; })
      .sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; })
      .map(function (s) { return { fecha: s.fecha, total: Number(s.monto) }; });
  }

  var api = { fechas: fechas, eventos: eventos, cuenta: cuenta, saldoAl: saldoAl, periodos: periodos, serieCuentas: serieCuentas, serieCuenta: serieCuenta,
              fechaDe: fechaDe, finMes: finMes, sumarDias: sumarDias, diasMes: diasMes, num: num, cent: cent };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else raiz.FinMotor = api;
})(typeof self !== 'undefined' ? self : this);
