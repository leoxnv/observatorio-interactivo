/*
 * Observatorio Interactivo — reemplazo estático de delitosmexico.onc.org.mx.
 *
 * Replica las vistas, controles y parámetros de URL de la plataforma actual
 * (unit, indicator, group, crime, state, period), pero sin servidor: todo se
 * calcula aquí a partir de los JSON que genera pipeline/sitio.py. Cada vista
 * vive en su propia carpeta (/tendencia/, /mapa/...) con una copia de la
 * misma página; el atributo data-ruta del <body> dice cuál pintar.
 */
"use strict";

const RAIZ = document.body.dataset.raiz || "./";
const RUTA = document.body.dataset.ruta || "";
// "variacion/1100" es el ranking por entidades de un delito, como en la plataforma.
const [VISTA, ARG] = RUTA.split("/");

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// Opciones de los selectores, con los mismos valores de URL que la plataforma actual.
const UNIDADES = [
  { value: "folders", name: "Carpetas de investigación", key: "ci" },
  { value: "victims", name: "Víctimas", key: "v" },
];
const INDICADORES = [
  { value: "researchFolders", name: "Números absolutos", key: "c" },
  { value: "researchFoldersRate", name: "Tasa por cada 100,000 habitantes", key: "t" },
];
const AGRUPACIONES = [
  { value: "month", name: "Mensual", n: 1, letra: "M" },
  { value: "twoMonth", name: "Bimestral", n: 2, letra: "B" },
  { value: "trimester", name: "Trimestral", n: 3, letra: "T" },
  { value: "quarter", name: "Cuatrimestral", n: 4, letra: "C" },
  { value: "semester", name: "Semestral", n: 6, letra: "S" },
  { value: "anual", name: "Anual", n: 12, letra: "A" },
  { value: "accumulated", name: "Acumulado anual", n: 0, letra: "C" },
];

const NF2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NF0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

let META, MAPA, CORTE;      // CORTE = último mes con datos, en meses absolutos
const cache = new Map();
let q;                       // parámetros de la URL vigentes

// ── Utilidades ──────────────────────────────────────────────────────────────
const $ = (s, r = document) => r.querySelector(s);
const SVGNS = "http://www.w3.org/2000/svg";
function h(tag, attrs = {}, ...hijos) {
  const svgTag = attrs._svg;
  const n = svgTag ? document.createElementNS(SVGNS, tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "_svg" || v == null || v === false) continue;
    if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of hijos.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : String(c));
  return n;
}
const s = (tag, attrs = {}, ...hijos) => h(tag, { ...attrs, _svg: true }, ...hijos);
const icono = (nombre, clase = "") => h("i", { class: `material-icons ${clase}`.trim() }, nombre);

const abs = (ym) => { const [y, m] = ym.split("-").map(Number); return y * 12 + m - 1; };
const anio = (k) => Math.floor(k / 12);
const mes = (k) => k % 12;
const ym = (k) => `${anio(k)}-${String(mes(k) + 1).padStart(2, "0")}`;

const delito = (code) => META.delitos.find((d) => d.codigo === Number(code)) || META.delitos[0];
const entidad = (e) => META.entidades[Number(e)] || META.entidades[0];
const nombreEntidad = (e, total = true) => (Number(e) === 0 && total ? "Total Nacional" : entidad(e).nombre);
const agrupacion = () => AGRUPACIONES.find((g) => g.value === q.group) || AGRUPACIONES[0];
const unidad = () => UNIDADES.find((u) => u.value === q.unit) || UNIDADES[0];
const indicador = () => INDICADORES.find((i) => i.value === q.indicator) || INDICADORES[1];
const fmt = (v) => (v == null ? "-" : indicador().key === "t" ? NF2.format(v) : NF0.format(v));
const iconoDelito = (code, clase = "") => {
  const d = delito(code);
  return h("div", { class: `icon icon_${d.codigo} ${clase}`.trim(), style: { backgroundColor: d.color, backgroundImage: `url(${RAIZ}assets/${d.icono ?? d.codigo}.svg)` } });
};
const principales = () => META.delitos.filter((d) => !d.padre);
const componentes = (code) => META.delitos.filter((d) => d.padre === code);
/**
 * Algunos delitos solo existen en una unidad: el homicidio de mujeres es un
 * conteo de víctimas, y el SESNSP no publica víctimas de varios robos. Si la
 * unidad elegida no existe para el delito, se cambia a la que sí.
 */
function ajustarUnidad(d) {
  if (unidad().key === "v" && !d.v_desde) q.unit = "folders";
  else if (unidad().key === "ci" && !d.ci_desde) q.unit = "victims";
}

// ── Datos ───────────────────────────────────────────────────────────────────
function cargar(ruta) {
  if (!cache.has(ruta)) {
    cache.set(ruta, fetch(RAIZ + ruta).then((r) => {
      if (!r.ok) throw new Error(`No se pudo cargar ${ruta}`);
      return r.json();
    }));
  }
  return cache.get(ruta);
}
const cargarDelito = (code) => cargar(`datos/delito/${code}.json`);
const cargarEntidad = (e) => cargar(`datos/entidad/${e}.json`);
// Nivel municipal: todo partido por estado, para bajar solo lo que se ve.
const cargarIndiceMpal = (e) => cargar(`datos/mpal/${e}/indice.json`);
// Hay delitos sin serie municipal (el homicidio de mujeres): vacío, sin pedirlo.
const cargarDelitoMpal = (e, code) => (delito(code).mpal ? cargar(`datos/mpal/${e}/delito/${code}.json`) : Promise.resolve({ ci: null, v: null }));
const avisoSinMunicipal = (d) => (d.mpal ? null : h("p", { class: "text-center aviso-datos" }, `El SESNSP no publica ${d.nombre.toLowerCase()} a nivel municipal; se muestra solo el total del estado.`));
const cargarMunicipio = (e, m) => cargar(`datos/mpal/${e}/municipio/${m}.json`);
const cargarMapaMpal = (e) => cargar(`datos/mpal/${e}/mapa.json`);
const entidadPorSlug = (sl) => META.entidades.find((x) => x.codigo > 0 && x.slug === sl);
const conMunicipios = () => META.entidades.filter((x) => x.municipios > 0);

/** Serie {inicio, arr} de un objeto de unidad ({inicio, c, t}); `e` si trae las 33 entidades. */
function serie(u, e) {
  if (!u) return null;
  const arr = u[indicador().key];
  return { inicio: abs(u.inicio), arr: e == null ? arr : arr[e] };
}
/** Suma de los meses k0..k1; null si falta cualquiera (un parcial engaña). */
function suma(se, k0, k1) {
  if (!se) return null;
  let t = 0;
  for (let k = k0; k <= k1; k++) {
    const i = k - se.inicio;
    const v = i >= 0 && i < se.arr.length ? se.arr[i] : null;
    if (v == null) return null;
    t += v;
  }
  return t;
}
const redondeo = (v) => (v == null ? null : +v.toFixed(indicador().key === "t" ? 4 : 0));
const variacion = (a, b) => (a == null || b == null || b === 0 ? null : ((a - b) / b) * 100);

// ── Periodos según la agrupación ────────────────────────────────────────────
/**
 * Periodos completos de la agrupación, del más reciente al más antiguo.
 * Cada uno: {k0, k1, clave, largo, corto}. `clave` va en el parámetro period.
 */
function periodos(g, desde = abs("1997-01")) {
  const out = [];
  const yc = anio(CORTE);
  if (g.n === 0) {
    const m = mes(CORTE);
    for (let y = yc; y * 12 >= desde; y--) {
      const rango = m === 0 ? MESES[0] : `${MESES[0]}-${MESES[m]}`;
      out.push({ k0: y * 12, k1: y * 12 + m, clave: String(y), largo: `${rango} (${y})`, corto: `${rango} (${y})` });
    }
    return out;
  }
  const porAnio = 12 / g.n;
  for (let y = yc; y * 12 + 11 >= desde; y--) {
    for (let p = porAnio; p >= 1; p--) {
      const k1 = y * 12 + p * g.n - 1;
      const k0 = k1 - g.n + 1;
      if (k1 > CORTE || k0 < desde) continue;
      let largo, corto;
      if (g.n === 1) { largo = `${MESES_LARGO[mes(k1)]} ${y}`; corto = `${MESES[mes(k1)]}. ${y}`; }
      else if (g.n === 12) { largo = corto = String(y); }
      else { largo = corto = `${p}${g.letra} ${y}`; }
      out.push({ k0, k1, clave: ym(k1), largo, corto });
    }
  }
  return out;
}
/** El periodo elegido en la URL, o el más reciente. */
function periodoActual(lista) {
  return lista.find((p) => p.clave === q.period) || lista[0];
}

// ── URL ─────────────────────────────────────────────────────────────────────
// `states` son los municipios elegidos en /tendencia/<estado> (0 = total del
// estado) y `municipality` el de la tabla de variación, como en la plataforma.
const DEFAULTS = { unit: "folders", indicator: "researchFoldersRate", group: "month", crime: "0", state: "0", period: "", states: "0", municipality: "0", crimes: "" };
function leerParams() {
  const p = new URLSearchParams(location.search);
  q = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) if (p.get(k)) q[k] = p.get(k);
  if (!AGRUPACIONES.some((g) => g.value === q.group)) q.group = "month";
  if (!UNIDADES.some((u) => u.value === q.unit)) q.unit = "folders";
  if (!INDICADORES.some((i) => i.value === q.indicator)) q.indicator = "researchFoldersRate";
  q.iframe = p.get("iframe") === "1";
}
function urlDe(ruta, params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (k in DEFAULTS) p.set(k, v ?? "");
  return `${RAIZ}${ruta ? ruta + "/" : ""}?${p}`;
}
function cambiar(cambios) {
  Object.assign(q, cambios);
  history.replaceState(null, "", urlDe(RUTA, q) + (q.iframe ? "&iframe=1" : ""));
  pintar();
}

// ── Selector desplegable (como el de la plataforma) ────────────────────────
function selector({ titulo, opciones, valor, onCambio, deshabilitado = false }) {
  const actual = opciones.find((o) => String(o.value) === String(valor));
  const cont = h("div", { class: "select-container" });
  const wrap = h("div", { class: `select-wrapper ${actual ? "selected" : ""} ${deshabilitado ? "disabled" : ""}` });
  const valorEl = h("span", { class: "select-value", style: { textTransform: "capitalize" } }, actual ? actual.name : (opciones[0]?.name ?? ""));
  const boton = h("a", { class: "select-content", role: "button", tabindex: deshabilitado ? -1 : 0, "aria-haspopup": "listbox" },
    valorEl, h("div", { class: "select-icon" }, icono("keyboard_arrow_down")));
  wrap.append(h("label", { class: "title", style: { cursor: deshabilitado ? "default" : "pointer" }, onclick: () => abrir() }, titulo), boton);
  cont.append(wrap);
  let abierto = null;
  const cerrar = () => { abierto?.forEach((n) => n.remove()); abierto = null; };
  const abrir = () => {
    if (deshabilitado || abierto) return cerrar();
    const capa = h("div", { class: "select-contextual-overlay", onclick: cerrar });
    const lista = h("div", { class: "select-contextual-scroll", role: "listbox" },
      opciones.map((o) => h("button", {
        type: "button", role: "option",
        class: `select-item ${String(o.value) === String(valor) ? "active" : ""} ${o.disabled ? "disabled" : ""}`,
        disabled: o.disabled, title: o.title, style: o.nivel ? { paddingLeft: `${10 + 16 * o.nivel}px` } : null,
        onclick: () => { cerrar(); if (String(o.value) !== String(valor)) onCambio(o.value); },
      }, o.name)));
    const caja = h("div", { class: "select-contextual-wrapper open" }, h("div", { class: "title-mobile" }, titulo), lista);
    document.body.append(capa);
    cont.append(caja);
    abierto = [capa, caja];
    lista.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  };
  boton.addEventListener("click", abrir);
  boton.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); abrir(); } });
  return cont;
}

const opcionesDelito = () => META.delitos.map((d) => ({ value: d.codigo, name: d.nombre, nivel: d.padre ? 1 : 0 }));
const opcionesUnidad = () => {
  const d = delito(q.crime);
  return UNIDADES.map((u) => {
    const falta = u.key === "v" ? !d.v_desde : !d.ci_desde;
    return { ...u, disabled: falta, title: falta ? (u.key === "v" ? "El SESNSP no publica víctimas de este delito" : "Este delito solo se publica en víctimas") : null };
  });
};
const opcionesPeriodo = (lista) => lista.map((p) => ({ value: p.clave, name: p.largo }));
const opcionesAgrupacion = (conAcumulado = true) => AGRUPACIONES.filter((g) => conAcumulado || g.n !== 0);

/** Barra de filtros superior. `cols` = [[clase de columna, nodo], ...] */
function barraFiltros(cols, { regresar = false } = {}) {
  const menu = h("div", { class: "container-fluid filter-menu-fluid" },
    h("div", { class: "row" }, cols.map(([clase, nodo]) => h("div", { class: `col col-12 ${clase} p-3` }, nodo))));
  const movil = h("div", { class: "container-fluid pt-3 pb-3 btn-filter-wrapper" },
    h("div", { class: "row" }, h("div", { class: "col-12 d-flex flex-row justify-content-between" },
      regresar ? botonRegresar("btn btn-back btn-black py-2 px-3 decoration-none d-flex align-items-center w-auto") : h("span"),
      h("button", { class: "btn-icon el-right", onclick: () => menu.classList.toggle("open") }, icono("filter_list"), h("span", {}, "Filtrar")))));
  return h("div", { class: "filter-wrapper" }, movil, menu);
}
function botonRegresar(clase) {
  return h("a", { class: clase, href: RAIZ, onclick: (ev) => { if (history.length > 1 && document.referrer.startsWith(location.origin)) { ev.preventDefault(); history.back(); } } },
    icono("arrow_back", "mr-2"), "Regresar");
}
function botonDescargar(onclick) {
  return h("div", { class: "row download-row mb-4" }, h("div", { class: "col-12 text-center d-flex align-items-center justify-content-end flex-column flex-md-row" },
    h("a", { class: "btn btn-black mx-2 d-flex align-items-center justify-content-center px-4 my-2 my-md-0", role: "button", onclick }, "Descargar datos")));
}

// ── Tooltip ─────────────────────────────────────────────────────────────────
const tip = {
  mostrar(ev, nodos) {
    const t = $("#tooltip");
    t.replaceChildren(...nodos);
    t.hidden = false;
    const r = t.getBoundingClientRect();
    let x = ev.clientX + 16, y = ev.clientY + 16;
    if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 16;
    if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 16;
    t.style.left = `${Math.max(8, x)}px`;
    t.style.top = `${Math.max(8, y)}px`;
  },
  ocultar() { $("#tooltip").hidden = true; },
};

// ── Descarga de archivos generados en el navegador ──────────────────────────
function bajar(nombre, contenido, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = h("a", { href: url, download: nombre });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csvDe(filas) {
  if (!filas.length) return "";
  const cols = Object.keys(filas[0]);
  const esc = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return "﻿" + [cols.join(","), ...filas.map((f) => cols.map((c) => esc(f[c])).join(","))].join("\n");
}

// ── Escalas ─────────────────────────────────────────────────────────────────
/** Marcas del eje con el mismo criterio que d3 (pasos de 1, 2 o 5 × 10^n). */
function ticksBonitos(max, n = 10) {
  if (!(max > 0)) return { paso: 1, ticks: [0] };
  const crudo = max / n;
  let paso = 10 ** Math.floor(Math.log10(crudo));
  const err = crudo / paso;
  if (err >= Math.sqrt(50)) paso *= 10;
  else if (err >= Math.sqrt(10)) paso *= 5;
  else if (err >= Math.sqrt(2)) paso *= 2;
  const ticks = [];
  for (let v = 0; v <= max + paso * 1e-9; v += paso) ticks.push(+v.toFixed(10));
  return { paso, ticks };
}
function fmtEje(v, paso) {
  const dec = paso >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(paso)));
  return v >= 1000 && paso >= 1 ? NF0.format(v) : v.toFixed(dec);
}
function mezcla(c1, c2, t) {
  const a = c1.match(/\w\w/g).map((x) => parseInt(x, 16));
  const b = c2.match(/\w\w/g).map((x) => parseInt(x, 16));
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
}
/** Rupturas naturales de Jenks (como dice la nota metodológica del sitio). */
function jenks(datos, clases) {
  const d = [...datos].sort((a, b) => a - b);
  const n = d.length;
  if (n <= clases) return [...new Set(d)];
  const lim = Array.from({ length: n + 1 }, () => Array(clases + 1).fill(0));
  const vari = Array.from({ length: n + 1 }, () => Array(clases + 1).fill(Infinity));
  for (let j = 1; j <= clases; j++) { lim[1][j] = 1; vari[1][j] = 0; }
  for (let l = 2; l <= n; l++) {
    let s1 = 0, s2 = 0, w = 0;
    for (let m = 1; m <= l; m++) {
      const i3 = l - m + 1, v = d[i3 - 1];
      s2 += v * v; s1 += v; w++;
      const varianza = s2 - (s1 * s1) / w;
      if (i3 !== 1) {
        for (let j = 2; j <= clases; j++) {
          if (vari[l][j] >= varianza + vari[i3 - 1][j - 1]) { lim[l][j] = i3; vari[l][j] = varianza + vari[i3 - 1][j - 1]; }
        }
      }
    }
    lim[l][1] = 1; vari[l][1] = s2 - (s1 * s1) / w;
  }
  const cortes = Array(clases + 1);
  cortes[clases] = d[n - 1]; cortes[0] = d[0];
  let k = n;
  for (let j = clases; j >= 2; j--) { const id = lim[k][j] - 2; cortes[j - 1] = d[id]; k = lim[k][j] - 1; }
  return cortes;
}

// ═══════════════════════════════════════════════════════════════════════════
// Vistas
// ═══════════════════════════════════════════════════════════════════════════

// ── Mapa coroplético (lo usan Inicio y Mapa de incidencia) ─────────────────
/**
 * Coroplético por rupturas naturales de Jenks. `geo` = {ancho, alto, trazos:
 * {clave: d}}; sirve igual para estados que para municipios.
 */
function mapaCoropletico({ geo, valor, nombre, color, onClick, etiqueta = "Mapa" }) {
  const claves = Object.keys(geo.trazos).map(Number);
  const vals = claves.map(valor).filter((v) => v != null);
  const cortes = vals.length ? jenks(vals, Math.min(5, new Set(vals).size || 1)) : [0, 0];
  const nClases = Math.max(1, cortes.length - 1);
  const claseDe = (v) => { for (let c = 1; c <= nClases; c++) if (v <= cortes[c]) return c; return nClases; };
  const tono = (c) => mezcla("f1f1f1", color.slice(1), nClases <= 1 ? 1 : (c - 1) / (nClases - 1) * 0.85 + 0.15);

  const svg = s("svg", { viewBox: `0 0 ${geo.ancho} ${geo.alto}`, role: "img", "aria-label": etiqueta });
  for (const clave of claves) {
    const v = valor(clave);
    const p = s("path", { d: geo.trazos[clave], fill: v == null ? "#9998af" : tono(claseDe(v)) });
    p.addEventListener("pointermove", (ev) => tip.mostrar(ev, [h("b", {}, nombre(clave)), h("div", {}, fmt(v))]));
    p.addEventListener("pointerleave", tip.ocultar);
    if (onClick) p.addEventListener("click", () => { tip.ocultar(); onClick(clave); });
    svg.append(p);
  }
  // Escala: un tramo por clase, de mayor (arriba) a menor; abajo, el mínimo.
  const escala = h("div", { class: "escala" });
  const barra = h("div", { class: "barra" });
  const ticks = h("div", { class: "ticks" });
  const alto = 46;
  for (let c = nClases; c >= 1; c--) {
    barra.append(h("div", { style: { height: `${alto}px`, background: tono(c) } }));
    ticks.append(h("span", { style: { top: `${(nClases - c) * alto}px` } }, h("b", {}, fmt(cortes[c]))));
  }
  ticks.append(h("span", { style: { top: `${nClases * alto}px` } }, h("b", {}, fmt(cortes[0]))));
  ticks.style.height = `${nClases * alto}px`;
  escala.append(barra, ticks);
  return { svg, escala, escalaHorizontal: () => leyendaHorizontal(cortes, tono, nClases) };
}
const geoEstados = () => ({ ancho: MAPA.ancho, alto: MAPA.alto, trazos: Object.fromEntries(Object.entries(MAPA.estados).map(([k, v]) => [k, v.d])) });
function leyendaHorizontal(cortes, tono, nClases) {
  const barra = h("div", { class: "barra d-flex" });
  const ticks = h("div", { class: "ticks" });
  for (let c = 1; c <= nClases; c++) barra.append(h("div", { style: { flex: 1, background: tono(c) } }));
  const corto = (v) => (v >= 100 ? NF0.format(v) : fmt(v));
  for (let c = 0; c <= nClases; c++) ticks.append(h("span", { style: { left: `${(c / nClases) * 100}%` } }, corto(cortes[c])));
  return h("div", { class: "legend horizontal" }, h("div", { class: "escala" }, barra, ticks));
}

// ── Inicio ──────────────────────────────────────────────────────────────────
async function vistaInicio(raiz) {
  q.indicator = "researchFoldersRate";
  const yc = anio(CORTE);
  const listaDelitos = h("div", { class: "delitosList py-4" },
    principales().map((d) => h("a", { href: urlDe("tendencia", { ...DEFAULTS, crime: d.codigo }) }, iconoDelito(d.codigo, "mr-2 small"), d.nombre)));
  const cajaMapa = h("div", { class: "box-content home-map mb-4" });
  raiz.append(
    h("div", { class: "container-fluid" },
      h("div", { class: "row" }, h("div", { class: "col-12 col-sm-8 offset-sm-2 mt-2" },
        h("h2", { class: "text-center", style: { marginTop: "1.5rem" } }, "Observatorio Interactivo de incidencia delictiva"),
        h("p", { class: "text-center" }, "Esta plataforma te permite visualizar los datos oficiales sobre incidencia delictiva en México. Explora las tendencias, las variaciones, las posiciones en el ranking por delito y la distribución geográfica."))),
      h("div", { class: "row mt-2 align-items-stretch" },
        h("div", { class: "col-12 col-sm-5" },
          h("a", { href: urlDe("variacion", DEFAULTS), style: { textDecoration: "none" } },
            h("div", { class: "box-content d-flex align-items-center justify-content-between" },
              h("div", { class: "title-section" }, h("h2", {}, "VER TABLA DE"), h("h1", {}, "Variación")),
              h("img", { src: `${RAIZ}assets/variacion.svg`, alt: "" }))),
          h("div", { class: "box-content mt-4 mb-4" },
            h("div", { class: "d-flex align-items-center justify-content-between mb-3" },
              h("div", { class: "title-section" }, h("h2", {}, "VER TENDENCIA POR"), h("h1", {}, "Tipo de Delito")),
              h("a", { class: "btn", href: urlDe("tendencia", DEFAULTS) }, "VER Total DE DELITOS")),
            listaDelitos)),
        h("div", { class: "col-12 col-sm-7" }, cajaMapa))));

  const dat = await cargarDelito(0);
  const se = (e) => ({ inicio: abs(dat.ci.inicio), arr: dat.ci.t[e] });
  const valores = META.entidades.map((x) => suma(se(x.codigo), yc * 12, CORTE));
  const mapa = mapaCoropletico({
    geo: geoEstados(), valor: (e) => valores[e], nombre: (e) => entidad(e).nombre, color: delito(0).color,
    etiqueta: "Mapa de la República por entidad",
    onClick: (e) => { location.href = urlDe(`mapa/${entidad(e).slug}`, { ...DEFAULTS, group: "accumulated" }); },
  });
  cajaMapa.append(
    h("div", { class: "header-map" },
      h("div", { class: "title-section" }, h("h2", {}, "VER INCIDENCIA POR"), h("h1", {}, "Entidad")),
      h("div", { class: "text-center" }, h("h2", { class: "m-0" }, String(yc)), h("h2", { class: "m-0", style: { fontSize: "24px" } }, "Total de Delitos")),
      h("div", {},
        selector({
          titulo: "Entidad", valor: 0,
          opciones: META.entidades.map((x) => ({ value: x.codigo, name: nombreEntidad(x.codigo) })),
          onCambio: (e) => { location.href = urlDe(Number(e) === 0 ? "mapa" : `mapa/${entidad(e).slug}`, DEFAULTS); },
        }),
        h("div", { class: "d-flex justify-content-end mt-4" }, h("a", { class: "btn", href: urlDe("mapa", DEFAULTS) }, "VER OTROS DELITOS")))),
    h("div", { class: "container-mapa mt-3" }, mapa.svg),
    mapa.escalaHorizontal(),
    h("p", { class: "text-center mt-2", style: { fontSize: "12px", color: "var(--label-color)" } },
      `Tasa por cada 100,000 habitantes, ${MESES[0]}-${MESES[mes(CORTE)]} ${yc}`));
}

// ── Líneas de tendencia ─────────────────────────────────────────────────────
function filtrosTendencia(d, g, explorar) {
  return barraFiltros([
    ["col-sm-3", selector({ titulo: "TIPO DE DELITO", opciones: opcionesDelito(), valor: d.codigo, onCambio: (v) => cambiar({ crime: v }) })],
    ["col-sm-3", selector({
      titulo: "EXPLORAR MUNICIPIOS", valor: explorar,
      opciones: [{ value: "", name: "Selecciona una entidad" }, ...conMunicipios().map((x) => ({ value: x.slug, name: x.nombre }))],
      onCambio: (v) => { location.href = urlDe(v ? `tendencia/${v}` : "tendencia", { ...q, states: "0", state: "0" }); },
    })],
    ["col-sm-2", selector({ titulo: "UNIDAD DE OBSERVACIÓN", opciones: opcionesUnidad(), valor: q.unit, onCambio: (v) => cambiar({ unit: v }) })],
    ["col-sm-2", selector({ titulo: "INDICADOR", opciones: INDICADORES, valor: q.indicator, onCambio: (v) => cambiar({ indicator: v }) })],
    ["col-sm-2", selector({ titulo: "AGRUPACIÓN", opciones: opcionesAgrupacion(false), valor: g.value, onCambio: (v) => cambiar({ group: v }) })],
  ], { regresar: true });
}

function cuerpoTendencia({ d, titulo, subtitulo, sidebar, alDescargar }) {
  return h("div", { class: "container-fluid mt-5" }, h("div", { class: "row align-items-stretch" },
    h("div", { class: "col col-12 mt-2 col-md-9" },
      h("div", { class: "d-flex align-items-center justify-content-between", style: { position: "relative" } },
        botonRegresar("hidden-xs btn-back btn btn-black py-2 px-3 decoration-none left w-auto d-flex align-items-center"),
        h("div", { class: "w-100 text-center" }, h("h2", { class: "text-center" }, titulo), h("p", { class: "text-center" }, subtitulo)),
        iconoDelito(d.codigo, "right")),
      h("div", { id: "multilinechart" }),
      botonDescargar(alDescargar)),
    h("div", { class: "col col-12 mt-2 mb-2 col-md-3" }, sidebar)));
}

function descargarSeries(nombre, d, lista, series) {
  const filas = [];
  for (const se of series) for (let i = 0; i < lista.length; i++) {
    filas.push({ serie: se.nombre, delito: d.nombre, unidad: unidad().name, indicador: indicador().name, periodo: lista[i].largo, valor: redondeo(se.pts[i]) });
  }
  bajar(nombre, csvDe(filas), "text/csv;charset=utf-8");
}

async function vistaTendencia(raiz) {
  const ent = ARG ? entidadPorSlug(ARG) : null;
  if (ent) return vistaTendenciaMunicipal(raiz, ent);
  const g = agrupacion().n === 0 ? AGRUPACIONES[0] : agrupacion();
  const d = delito(q.crime);
  ajustarUnidad(d);
  let estados = [...new Set(q.state.split(",").map(Number).filter((e) => e >= 0 && e <= 32))].slice(0, 10);
  if (!estados.length) estados = [0];

  const dat = await cargarDelito(d.codigo);
  const u = dat[unidad().key];
  const lista = periodos(g, abs(u.inicio)).reverse();
  const series = estados.map((e) => ({ nombre: entidad(e).nombre, color: entidad(e).color, pts: lista.map((p) => suma(serie(u, e), p.k0, p.k1)) }));

  raiz.append(h("div", { class: "box-height" },
    filtrosTendencia(d, g, ""),
    cuerpoTendencia({
      d, titulo: d.nombre, subtitulo: estados.map((e) => entidad(e).nombre).join(", "),
      alDescargar: () => descargarSeries(`tendencia_${d.codigo}.csv`, d, lista, series),
      sidebar: sidebarSeleccion({
        etiqueta: "Entidades seleccionadas:", sel: estados,
        items: META.entidades.map((x) => ({ clave: x.codigo, nombre: x.nombre, color: x.color })),
        alCambiar: (sel) => cambiar({ state: sel.join(",") }),
      }),
    })));
  // La gráfica necesita su ancho real, que solo existe ya insertada en la página.
  return () => graficaLineas($("#multilinechart"), lista, series, g);
}

// /tendencia/<estado>: el total del estado y sus municipios (hasta 10).
async function vistaTendenciaMunicipal(raiz, ent) {
  const g = agrupacion().n === 0 ? AGRUPACIONES[0] : agrupacion();
  const d = delito(q.crime);
  ajustarUnidad(d);
  const [indice, datEst, datMun] = await Promise.all([cargarIndiceMpal(ent.codigo), cargarDelito(d.codigo), cargarDelitoMpal(ent.codigo, d.codigo)]);
  const pos = new Map(indice.municipios.map((m, i) => [m.codigo, i]));
  let sel = [...new Set(q.states.split(",").map(Number).filter((m) => m === 0 || pos.has(m)))].slice(0, 10);
  if (!sel.length) sel = [0];

  // Colores en el orden en que se eligen; el total del estado, en verde.
  const paleta = META.entidades.slice(1).map((x) => x.color);
  const colorDe = (m) => (m === 0 ? META.entidades[0].color : paleta[(sel.indexOf(m) - (sel.includes(0) ? 1 : 0) + paleta.length) % paleta.length]);
  const nombreDe = (m) => (m === 0 ? "Total Entidad" : indice.municipios[pos.get(m)].nombre);

  const uEst = datEst[unidad().key], uMun = datMun[unidad().key];
  const lista = periodos(g, abs(uEst.inicio)).reverse();
  const series = sel.map((m) => {
    const se = m === 0 ? serie(uEst, ent.codigo) : serie(uMun, pos.get(m));
    return { nombre: nombreDe(m), color: colorDe(m), pts: lista.map((p) => suma(se, p.k0, p.k1)) };
  });

  raiz.append(h("div", { class: "box-height" },
    filtrosTendencia(d, g, ent.slug),
    avisoSinMunicipal(d),
    cuerpoTendencia({
      d, titulo: ent.nombre, subtitulo: d.nombre,
      alDescargar: () => descargarSeries(`tendencia_${ent.slug}_${d.codigo}.csv`, d, lista, series),
      sidebar: sidebarSeleccion({
        etiqueta: "Municipios seleccionados:", sel, buscador: "Buscar municipio",
        items: [{ clave: 0, nombre: "Total Entidad" }, ...indice.municipios.map((m) => ({ clave: m.codigo, nombre: m.nombre }))].map((x) => ({ ...x, color: sel.includes(x.clave) ? colorDe(x.clave) : null })),
        alCambiar: (nuevo) => cambiar({ states: nuevo.join(",") }),
      }),
    })));
  return () => graficaLineas($("#multilinechart"), lista, series, g);
}

/** Barra lateral con casillas (máx. 10), como la de la plataforma. */
function sidebarSeleccion({ etiqueta, sel, items, alCambiar, buscador, max = 10 }) {
  const elegidos = new Set(sel);
  const toggle = (clave) => {
    if (elegidos.has(clave)) { if (elegidos.size > 1) elegidos.delete(clave); }
    else if (elegidos.size < max) elegidos.add(clave);
    alCambiar([...elegidos]);
  };
  const filas = items.map((x) => {
    const on = elegidos.has(x.clave);
    return h("div", { class: "select-item", role: "checkbox", "aria-checked": on, tabindex: 0, "data-nombre": x.nombre.toLowerCase(),
      style: x.nivel ? { paddingLeft: `${10 + 24 * x.nivel}px` } : null,
      onclick: () => toggle(x.clave), onkeydown: (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggle(x.clave); } } },
      h("div", { class: `radio checkbox ${on ? "active" : ""}`, style: { background: on ? x.color : "none" } }, on ? icono("done") : null),
      h("span", { class: `radio-label ${on ? "active" : ""}` }, x.nombre));
  });
  const sinAcentos = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return h("div", { class: "box-content box-content-sidebar py-4", id: "sidebar" },
    h("div", {},
      h("span", {}, h("label", { class: "mr-1" }, etiqueta), h("b", {}, String(elegidos.size)), h("br"), h("label", {}, `(Máx ${max})`)),
      h("br"),
      h("a", { class: "d-block link mt-2 pointer", onclick: () => alCambiar([items[0].clave]) }, "Limpiar todo")),
    h("hr", { class: "my-4" }),
    buscador ? h("input", { type: "text", autocomplete: "off", placeholder: buscador, class: "input-buscar",
      oninput: (ev) => {
        const t = sinAcentos(ev.target.value.trim());
        for (const f of filas) f.hidden = t && !sinAcentos(f.dataset.nombre).includes(t);
      } }) : null,
    h("div", { class: "box-entidades" }, filas));
}

function graficaLineas(cont, lista, series, g) {
  const W = cont.clientWidth;
  const H = Math.max(320, Math.min(520, innerHeight - 330));
  const M = { l: 45, r: 10, t: 10, b: 30 };
  const HB = 70;   // alto del selector de rango (brush)
  const n = lista.length;
  let [i0, i1] = [0, n - 1];

  const svg = s("svg", { viewBox: `0 0 ${W} ${H + HB}`, height: H + HB });
  const plot = s("g");
  const brushG = s("g", { class: "brush", transform: `translate(0,${H + 10})` });
  svg.append(plot, brushG);

  const Xb = (i) => M.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - M.l - M.r));
  const etiquetaX = (p) => (g.n === 12 ? String(anio(p.k1)) : String(anio(p.k1)));
  const ticksAnio = (a, b, X, y, grupo) => {
    const anios = anio(lista[b].k1) - anio(lista[a].k0) + 1;
    const cada = [1, 2, 5, 10].find((c) => anios / c <= Math.max(3, (W - M.l) / 55)) || 10;
    for (let i = a; i <= b; i++) {
      const p = lista[i];
      const inicioAnio = g.n === 12 || mes(p.k0) === 0;
      if (!inicioAnio || anio(p.k1) % cada !== 0) continue;
      grupo.append(s("line", { x1: X(i), x2: X(i), y1: y, y2: y + 6 }), s("text", { x: X(i), y: y + 17, "text-anchor": "middle" }, etiquetaX(p)));
    }
  };

  function dibujar() {
    plot.replaceChildren();
    const X = (i) => M.l + (i1 === i0 ? 0 : ((i - i0) / (i1 - i0)) * (W - M.l - M.r));
    let max = 0;
    for (const se of series) for (let i = i0; i <= i1; i++) if (se.pts[i] != null) max = Math.max(max, se.pts[i]);
    const { paso, ticks } = ticksBonitos(max || 1);
    const ymax = max || 1;
    const Y = (v) => H - M.b - (v / ymax) * (H - M.t - M.b);

    const ejeY = s("g", { class: "axis" });
    ejeY.append(s("line", { x1: M.l, x2: M.l, y1: M.t, y2: H - M.b }));
    for (const v of ticks) ejeY.append(s("line", { x1: M.l - 6, x2: M.l, y1: Y(v), y2: Y(v) }), s("text", { x: M.l - 9, y: Y(v) + 3, "text-anchor": "end" }, fmtEje(v, paso)));
    const ejeX = s("g", { class: "axis" });
    ticksAnio(i0, i1, X, H - M.b, ejeX);
    plot.append(ejeY, ejeX);

    for (const se of series) {
      let dd = "", pen = false;
      for (let i = i0; i <= i1; i++) {
        const v = se.pts[i];
        if (v == null) { pen = false; continue; }
        dd += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
        pen = true;
      }
      plot.append(s("path", { d: dd, fill: "none", stroke: se.color, "stroke-width": 1.5, "stroke-linejoin": "round" }));
    }
    const guia = s("line", { y1: M.t, y2: H - M.b, stroke: "var(--label-color)", "stroke-dasharray": "3 3", visibility: "hidden" });
    const puntos = series.map((se) => s("circle", { r: 4, fill: se.color, stroke: "var(--primary-color)", "stroke-width": 1.5, visibility: "hidden" }));
    const zona = s("rect", { x: M.l, y: M.t, width: Math.max(0, W - M.l - M.r), height: H - M.t - M.b, fill: "transparent" });
    plot.append(guia, ...puntos, zona);
    const mover = (ev) => {
      const r = svg.getBoundingClientRect();
      const x = (ev.clientX - r.left) * (W / r.width);
      const i = Math.max(i0, Math.min(i1, Math.round(i0 + ((x - M.l) / (W - M.l - M.r)) * (i1 - i0))));
      guia.setAttribute("x1", X(i)); guia.setAttribute("x2", X(i)); guia.setAttribute("visibility", "visible");
      const filas = [h("b", { style: { textTransform: "capitalize" } }, lista[i].largo)];
      series.forEach((se, j) => {
        const v = se.pts[i];
        if (v == null) puntos[j].setAttribute("visibility", "hidden");
        else { puntos[j].setAttribute("cx", X(i)); puntos[j].setAttribute("cy", Y(v)); puntos[j].setAttribute("visibility", "visible"); }
        filas.push(h("div", {}, h("span", { class: "circle", style: { background: se.color } }), `${se.nombre}: `, h("b", {}, fmt(v))));
      });
      tip.mostrar(ev, filas);
    };
    zona.addEventListener("pointermove", mover);
    zona.addEventListener("pointerdown", mover);
    zona.addEventListener("pointerleave", () => { tip.ocultar(); guia.setAttribute("visibility", "hidden"); puntos.forEach((p) => p.setAttribute("visibility", "hidden")); });
  }

  // Selector de rango: barra verde con asas, como el brush de la plataforma.
  const fondo = s("rect", { class: "overlay", x: M.l, y: 0, width: W - M.l - M.r, height: 25 });
  const sel = s("rect", { class: "selection", y: 0, height: 25 });
  const asaA = s("rect", { class: "handle", y: -2.5, width: 6, height: 30 });
  const asaB = s("rect", { class: "handle", y: -2.5, width: 6, height: 30 });
  const ejeB = s("g", { class: "axis" });
  ticksAnio(0, n - 1, Xb, 28, ejeB);
  brushG.append(fondo, sel, asaA, asaB, ejeB);
  const pintarBrush = () => {
    sel.setAttribute("x", Xb(i0)); sel.setAttribute("width", Math.max(1, Xb(i1) - Xb(i0)));
    asaA.setAttribute("x", Xb(i0) - 3); asaB.setAttribute("x", Xb(i1) - 3);
  };
  const indice = (ev) => {
    const r = svg.getBoundingClientRect();
    const x = (ev.clientX - r.left) * (W / r.width);
    return Math.max(0, Math.min(n - 1, Math.round(((x - M.l) / (W - M.l - M.r)) * (n - 1))));
  };
  let arrastre = null;
  const empezar = (tipo) => (ev) => { ev.preventDefault(); arrastre = { tipo, i: indice(ev), a: i0, b: i1 }; svg.setPointerCapture(ev.pointerId); };
  asaA.addEventListener("pointerdown", empezar("a"));
  asaB.addEventListener("pointerdown", empezar("b"));
  sel.addEventListener("pointerdown", empezar("mover"));
  fondo.addEventListener("pointerdown", (ev) => { const i = indice(ev); arrastre = { tipo: "nuevo", i, a: i, b: i }; svg.setPointerCapture(ev.pointerId); });
  svg.addEventListener("pointermove", (ev) => {
    if (!arrastre) return;
    const i = indice(ev), min = Math.min(12, n - 1);
    if (arrastre.tipo === "a") i0 = Math.min(i, i1 - min);
    else if (arrastre.tipo === "b") i1 = Math.max(i, i0 + min);
    else if (arrastre.tipo === "nuevo") { i0 = Math.min(arrastre.i, i); i1 = Math.max(arrastre.i, i); }
    else { const dlt = Math.max(-arrastre.a, Math.min(n - 1 - arrastre.b, i - arrastre.i)); i0 = arrastre.a + dlt; i1 = arrastre.b + dlt; }
    pintarBrush(); dibujar();
  });
  svg.addEventListener("pointerup", () => {
    if (arrastre?.tipo === "nuevo" && i1 - i0 < 2) { i0 = 0; i1 = n - 1; pintarBrush(); dibujar(); }
    arrastre = null;
  });

  pintarBrush();
  dibujar();
  cont.replaceChildren(svg);
}

// ── Mapa de incidencia ──────────────────────────────────────────────────────
function radiosDelito(d) {
  return META.delitos.map((x) => {
    const on = x.codigo === d.codigo;
    return h("div", { class: "select-item", role: "radio", "aria-checked": on, tabindex: 0, style: x.padre ? { paddingLeft: "34px" } : null,
      onclick: () => cambiar({ crime: x.codigo }), onkeydown: (ev) => { if (ev.key === "Enter") cambiar({ crime: x.codigo }); } },
      h("div", { class: `radio ${on ? "active" : ""}`, style: { background: on ? x.color : "none" } }, on ? icono("done") : null),
      h("span", { class: `radio-label ${on ? "active" : ""}` }, x.nombre));
  });
}

function vistaMapaMarco({ d, g, lista, per, ent, mapa, extra, alDescargar }) {
  return h("div", { class: "box-height" },
    barraFiltros([
      ["col-sm-6 col-md-6 col-lg-3", selector({
        titulo: "ENTIDAD", valor: ent ? ent.slug : "",
        opciones: [{ value: "", name: "Total Nacional" }, ...conMunicipios().map((x) => ({ value: x.slug, name: x.nombre }))],
        onCambio: (v) => { location.href = urlDe(v ? `mapa/${v}` : "mapa", { ...q, period: "" }); },
      })],
      ["col-sm-6 col-md-6 col-lg-3", selector({ titulo: "UNIDAD DE OBSERVACIÓN", opciones: opcionesUnidad(), valor: q.unit, onCambio: (v) => cambiar({ unit: v, period: "" }) })],
      ["col-sm-6 col-md-6 col-lg-2", selector({ titulo: "INDICADOR", opciones: INDICADORES, valor: q.indicator, onCambio: (v) => cambiar({ indicator: v }) })],
      ["col-sm-6 col-md-6 col-lg-2", selector({ titulo: "PERÍODO", opciones: opcionesPeriodo(lista), valor: per.clave, onCambio: (v) => cambiar({ period: v }) })],
      ["col-sm-6 col-md-6 col-lg-2", selector({ titulo: "AGRUPACIÓN", opciones: opcionesAgrupacion(), valor: g.value, onCambio: (v) => cambiar({ group: v, period: "" }) })],
    ]),
    h("div", { class: "container-fluid mt-5", id: ent ? "mapaMunicipal" : "mapaNacional" }, h("div", { class: "row align-items-stretch" },
      h("div", { class: "col col-12 mt-2 col-md-9" },
        h("div", { class: "d-flex align-items-center", style: { position: "relative" } },
          ent ? botonRegresar("hidden-xs btn-back btn btn-black py-2 px-3 decoration-none left w-auto d-flex align-items-center") : null,
          h("div", { class: "w-100" }, h("h2", { class: "text-center m-0" }, ent ? ent.nombre : "Total Nacional"), h("p", { class: "text-center mt-2" }, d.nombre)),
          iconoDelito(d.codigo, "right")),
        h("div", { class: "box-content box-content-opacity d-flex mb-5 pb-5 mapa-caja", style: { position: "relative" } },
          h("div", { class: "legend" }, h("div", {}, h("p", {}, indicador().key === "t" ? "Tasa por cada 100,000 habitantes" : unidad().name), mapa.escala)),
          h("div", { class: "w-100 d-flex align-items-center mapa-y-extra" },
            h("div", { class: "container-mapa", id: "containerMap", style: ent ? { maxWidth: "460px", margin: "0 auto" } : null }, mapa.svg),
            extra)),
        botonDescargar(alDescargar)),
      h("div", { class: "col col-12 mt-2 mb-2 col-md-3" },
        h("div", { class: "box-content box-content-sidebar py-4 mb-2" },
          h("div", { class: "d-flex align-items-center justify-content-between" },
            h("span", {}, h("label", { class: "muted-color mr-1" }, "Mostrar:"), d.nombre)),
          h("hr", { class: "my-4" }), radiosDelito(d))))));
}

async function vistaMapa(raiz) {
  const ent = ARG ? entidadPorSlug(ARG) : null;
  if (ent) return vistaMapaMunicipal(raiz, ent);
  const g = agrupacion();
  const d = delito(q.crime);
  ajustarUnidad(d);
  const dat = await cargarDelito(d.codigo);
  const u = dat[unidad().key];
  const lista = periodos(g, abs(u.inicio));
  const per = periodoActual(lista);
  const valores = META.entidades.map((x) => suma(serie(u, x.codigo), per.k0, per.k1));
  const mapa = mapaCoropletico({
    geo: geoEstados(), valor: (e) => valores[e], nombre: (e) => entidad(e).nombre, color: d.color,
    etiqueta: "Mapa de la República por entidad",
    // Como en la plataforma: el estado abre su mapa por municipios.
    onClick: (e) => { location.href = urlDe(`mapa/${entidad(e).slug}`, { ...q }); },
  });
  raiz.append(vistaMapaMarco({
    d, g, lista, per, ent: null, mapa,
    alDescargar: () => {
      const filas = META.entidades.map((x) => ({ inegiEntidad: x.codigo, entidad: x.nombre, delito: d.nombre, unidad: unidad().name, indicador: indicador().name, periodo: per.largo, valor: redondeo(valores[x.codigo]) }));
      bajar(`mapa_${d.codigo}_${per.clave}.csv`, csvDe(filas), "text/csv;charset=utf-8");
    },
  }));
}

// /mapa/<estado>: sus municipios, con los observatorios locales al lado.
async function vistaMapaMunicipal(raiz, ent) {
  const g = agrupacion();
  const d = delito(q.crime);
  ajustarUnidad(d);
  const [indice, geo, dat] = await Promise.all([cargarIndiceMpal(ent.codigo), cargarMapaMpal(ent.codigo), cargarDelitoMpal(ent.codigo, d.codigo)]);
  const u = dat[unidad().key];
  const lista = u ? periodos(g, abs(u.inicio)) : periodos(g);
  const per = periodoActual(lista);
  const pos = new Map(indice.municipios.map((m, i) => [m.codigo, i]));
  const valor = (m) => (u && pos.has(m) ? suma(serie(u, pos.get(m)), per.k0, per.k1) : null);
  const nombre = (m) => (pos.has(m) ? indice.municipios[pos.get(m)].nombre : String(m));
  const mapa = mapaCoropletico({
    geo, valor, nombre, color: d.color, etiqueta: `Mapa de ${ent.nombre} por municipio`,
    onClick: (m) => { location.href = urlDe(`tendencia/${ent.slug}`, { ...q, states: `0,${m}`, group: grupoTendencia(g) }); },
  });
  const extra = indice.observatorios.length ? h("div", { class: "observatorios" },
    h("h3", {}, "Observatorios en esta entidad"),
    h("ul", {}, indice.observatorios.map((o) => h("li", {},
      o.sitio ? h("a", { class: "underline", href: /^https?:/.test(o.sitio) ? o.sitio : `https://${o.sitio}`, target: "_blank", rel: "noopener" }, o.nombre) : o.nombre)))) : null;
  const aviso = avisoSinMunicipal(d);
  if (aviso) aviso.textContent = `El SESNSP no publica ${d.nombre.toLowerCase()} a nivel municipal.`;
  raiz.append(vistaMapaMarco({
    d, g, lista, per, ent, mapa, extra: aviso ? [aviso, extra] : extra,
    alDescargar: () => {
      const filas = indice.municipios.map((m) => ({ inegiMunicipio: m.codigo, municipio: m.nombre, entidad: ent.nombre, delito: d.nombre, unidad: unidad().name, indicador: indicador().name, periodo: per.largo, valor: redondeo(valor(m.codigo)) }));
      bajar(`mapa_${ent.slug}_${d.codigo}_${per.clave}.csv`, csvDe(filas), "text/csv;charset=utf-8");
    },
  }));
}

// ── Tabla de variación ──────────────────────────────────────────────────────
function barchart(p) {
  const ancho = p == null ? 0 : Math.max(1, Math.min(100, Math.abs(p)));
  const izq = h("div", { class: "bar" }, p != null && p < 0 ? h("div", { class: "progress", style: { width: `${ancho}%` } }) : null);
  const der = h("div", { class: "bar" }, p != null && p >= 0 ? h("div", { class: "progress", style: { width: `${ancho}%` } }) : null);
  return h("div", { class: "barchart" }, h("div", { class: "divider" }), h("div", { class: "barchart-content" }, izq, der),
    h("div", { class: `value ${p != null && p < 0 ? "left" : ""}` }, p == null ? "n.d." : `${NF2.format(p)}%`));
}
function sparkline(vals) {
  const W = 80, H = 30;
  const v = vals.filter((x) => x != null);
  if (v.length < 2) return s("svg", { width: W, height: H });
  const min = Math.min(...v), max = Math.max(...v);
  let dd = "", pen = false;
  vals.forEach((x, i) => {
    if (x == null) { pen = false; return; }
    const px = (i / (vals.length - 1)) * W, py = H - 2 - ((x - min) / (max - min || 1)) * (H - 4);
    dd += `${pen ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`; pen = true;
  });
  return s("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, s("path", { d: dd, fill: "none", stroke: "#43ab34", "stroke-width": 1.5 }));
}

/**
 * Contexto de comparación para la tabla de variación: el periodo elegido, el
 * mismo periodo del año pasado y el periodo inmediato anterior.
 */
function contextoVariacion(g, lista) {
  const per = periodoActual(lista);
  const idx = lista.indexOf(per);
  const anterior = lista[idx + 1];
  const conAnterior = g.n !== 0 && g.n !== 12;
  const pasado = { k0: per.k0 - 12, k1: per.k1 - 12 };
  const etPasado = g.n === 0 ? per.corto.replace(String(anio(per.k1)), String(anio(per.k1) - 1))
    : (lista.find((p) => p.k1 === pasado.k1)?.corto ?? "");
  const historia = lista.slice(idx).filter((p) => anio(p.k0) >= 2015).reverse();
  return { per, anterior, conAnterior, pasado, etPasado, historia };
}
function valoresVariacion(se, cx) {
  const act = suma(se, cx.per.k0, cx.per.k1);
  const pas = suma(se, cx.pasado.k0, cx.pasado.k1);
  const ant = cx.anterior ? suma(se, cx.anterior.k0, cx.anterior.k1) : null;
  return { act, pas, ant, vPas: variacion(act, pas), vAnt: variacion(act, ant), historia: cx.historia.map((p) => suma(se, p.k0, p.k1)) };
}

/**
 * La tabla en sí, igual para las dos variantes. Cada fila: {nombre (nodo o
 * texto), act, pas, ant, vPas, vAnt, historia, irA, irATendencia}.
 */
function tablaVariacion({ columna, cx, filas }) {
  const u = unidad();
  const encabezado = h("div", { class: "table-item bg-lg-none", style: { fontSize: "13px" } },
    h("div", { class: "table-item-description" }, h("div", { class: "table-item-name" }, columna)),
    h("div", { class: "px-3 flex-shrink-0", style: { fontSize: "12px", minWidth: "232px", textAlign: "center" } },
      h("span", {}, indicador().key === "t" ? "Tasa por cada 100,000 habitantes" : u.name),
      h("div", { class: "d-flex justify-content-between legend-month", style: { minWidth: "200px" } },
        [cx.etPasado, cx.conAnterior ? cx.anterior?.corto : null, cx.per.corto].filter((x) => x != null).map((t) => h("div", { class: "mt-2 mx-auto uppercase" }, t)))),
    h("div", { class: "table-item-bars" },
      h("div", { class: "px-4 flex-shrink-0" }, "Var año pasado", h("div", { class: "d-flex justify-content-between" }, h("span", {}, "-"), h("span", {}, "+"))),
      cx.conAnterior ? h("div", { class: "px-2 flex-shrink-0" }, "Var periodo anterior", h("div", { class: "d-flex justify-content-between" }, h("span", {}, "-"), h("span", {}, "+"))) : null,
      h("div", { class: "px-4" }, "Tendencia")));

  const conDesglose = filas.some((x) => x.hijos?.length);
  const renglon = (f, hijo = false, alternar = null) => h("div", {
    class: `table-item cursor ${hijo ? "hijo" : ""}`, role: "link", tabindex: 0, hidden: hijo,
    onclick: f.irA, onkeydown: (ev) => { if (ev.key === "Enter") f.irA(); },
  },
    h("div", { class: "table-item-description" },
      // Botón para desplegar los componentes; deja su hueco aunque no haya, para alinear.
      alternar ? h("button", { type: "button", class: "desplegar", title: "Ver componentes", "aria-expanded": "false", onclick: alternar }, icono("chevron_right"))
        : (conDesglose && !hijo ? h("span", { class: "desplegar-hueco" }) : null),
      f.nombre),
    h("div", { class: "table-item-values" }, h("div", {}, fmt(f.pas)), cx.conAnterior ? h("div", {}, fmt(f.ant)) : null, h("div", {}, fmt(f.act))),
    h("div", { class: "table-item-bars" }, barchart(f.vPas), cx.conAnterior ? barchart(f.vAnt) : null,
      // La minitendencia lleva a las líneas de tendencia, como en la plataforma.
      h("div", { class: "cursor", title: "Ver líneas de tendencia", onclick: (ev) => { ev.stopPropagation(); f.irATendencia(); } },
        h("div", { class: "tendencia-char" }, h("div", { class: "text-center" }, sparkline(f.historia))))));
  const cuerpo = filas.flatMap((f) => {
    if (!f.hijos?.length) return [renglon(f)];
    const hijos = f.hijos.map((x) => renglon(x, true));
    const alternar = (ev) => {
      ev.stopPropagation();
      const b = ev.currentTarget, abierto = b.getAttribute("aria-expanded") !== "true";
      b.setAttribute("aria-expanded", String(abierto));
      for (const r of hijos) r.hidden = !abierto;
    };
    return [renglon(f, false, alternar), ...hijos];
  });
  return h("div", { class: "table-wrapper-mobile" }, encabezado, cuerpo);
}

function csvVariacion(cx, filas) {
  return filas.flatMap((f) => [f, ...(f.hijos || [])]).map((f) => ({
    ...f.columnas, unidad: unidad().name, indicador: indicador().name,
    [cx.etPasado]: redondeo(f.pas), ...(cx.conAnterior ? { [cx.anterior?.corto ?? "anterior"]: redondeo(f.ant) } : {}), [cx.per.corto]: redondeo(f.act),
    var_anio_pasado: f.vPas == null ? null : +f.vPas.toFixed(2),
    ...(cx.conAnterior ? { var_periodo_anterior: f.vAnt == null ? null : +f.vAnt.toFixed(2) } : {}),
  }));
}
const grupoTendencia = (g) => (g.n === 0 ? "month" : g.value);

// Tabla de variación por tipo de delito: una entidad (o un municipio), todos los delitos.
async function vistaVariacion(raiz) {
  const g = agrupacion();
  const e = Math.max(0, Math.min(32, Number(q.state.split(",")[0]) || 0));
  const ent = entidad(e);
  const indice = e > 0 && ent.municipios ? await cargarIndiceMpal(e) : null;
  const mun = indice?.municipios.find((m) => m.codigo === Number(q.municipality)) || null;
  const datos = mun ? await cargarMunicipio(e, mun.codigo) : await cargarEntidad(e);
  const u = unidad();
  // Lo municipal arranca en 2015; ofrecer periodos anteriores dejaría la tabla vacía.
  const lista = periodos(g, mun ? abs("2015-01") : abs("1997-01"));
  const cx = contextoVariacion(g, lista);

  // Las tablas son referenciales: los componentes se despliegan bajo su
  // delito para leerlo mejor, no para sumarlos.
  const soloEn = (d) => (u.key === "ci" && !d.ci_desde ? " (solo en víctimas)" : u.key === "v" && !d.v_desde ? " (solo en carpetas)" : "");
  const fila = (d) => ({
    ...valoresVariacion(serie(datos.delitos[d.codigo]?.[u.key]), cx),
    nombre: d.padre ? h("div", { class: "table-item-name" }, (d.corto || d.nombre) + soloEn(d))
      : [iconoDelito(d.codigo), h("div", { class: "table-item-name" }, d.nombre + soloEn(d))],
    columnas: { entidad: nombreEntidad(e), ...(mun ? { municipio: mun.nombre } : {}), delito: d.nombre },
    // Como en la plataforma: el delito abre su ranking, por entidades en el
    // nacional y por municipios con un estado elegido.
    irA: () => {
      location.href = mun ? urlDe(`tendencia/${ent.slug}`, { ...q, crime: d.codigo, states: `0,${mun.codigo}`, group: grupoTendencia(g) })
        : e > 0 && ent.municipios ? urlDe(`ranking/${ent.slug}`, { ...q, crime: d.codigo })
          : urlDe(`variacion/${d.codigo}`, { ...q, crime: d.codigo });
    },
    irATendencia: () => {
      location.href = mun ? urlDe(`tendencia/${ent.slug}`, { ...q, crime: d.codigo, states: `0,${mun.codigo}`, group: grupoTendencia(g) })
        : urlDe("tendencia", { ...q, crime: d.codigo, state: e, group: grupoTendencia(g) });
    },
  });
  const filas = principales().map((d) => ({ ...fila(d), hijos: componentes(d.codigo).map(fila) }));

  const ancho = "col-sm-2";
  const cols = [
    [ancho, selector({ titulo: "ENTIDAD", valor: e, opciones: META.entidades.map((x) => ({ value: x.codigo, name: nombreEntidad(x.codigo) })), onCambio: (v) => cambiar({ state: v, municipality: "0", period: "" }) })],
    indice ? [ancho, selector({ titulo: "MUNICIPIO", valor: mun ? mun.codigo : 0,
      opciones: [{ value: 0, name: `Total ${ent.nombre}` }, ...indice.municipios.map((m) => ({ value: m.codigo, name: m.nombre }))],
      onCambio: (v) => cambiar({ municipality: v, period: "" }) })] : null,
    [ancho, selector({ titulo: "UNIDAD DE OBSERVACIÓN", opciones: UNIDADES, valor: q.unit, onCambio: (v) => cambiar({ unit: v }) })],
    [ancho, selector({ titulo: "INDICADOR", opciones: INDICADORES, valor: q.indicator, onCambio: (v) => cambiar({ indicator: v }) })],
    [ancho, selector({ titulo: "PERÍODO", opciones: opcionesPeriodo(lista), valor: cx.per.clave, onCambio: (v) => cambiar({ period: v }) })],
    [ancho, selector({ titulo: "AGRUPACIÓN", opciones: opcionesAgrupacion(), valor: g.value, onCambio: (v) => cambiar({ group: v, period: "" }) })],
  ].filter(Boolean);
  // Con un estado elegido el título es el lugar, como en la plataforma.
  const titulo = e === 0 ? "Tabla de Variación Por Tipo de Delito" : mun ? `${mun.nombre}, ${ent.nombre}` : ent.nombre;
  const subtitulo = e === 0 ? nombreEntidad(0) : "Todos los tipos de delito";

  raiz.append(h("div", {},
    barraFiltros(cols),
    h("div", { class: "container mt-5" }, h("div", { class: "row" }, h("div", { class: "col col-12" },
      h("div", {}, h("h2", { class: "text-center m-0" }, titulo), h("p", { class: "text-center mb-4 mt-2" }, subtitulo)),
      tablaVariacion({ columna: "Tipo de delito", cx, filas }),
      botonDescargar(() => bajar(`variacion_${mun ? mun.codigo : e}_${cx.per.clave}.csv`, csvDe(csvVariacion(cx, filas)), "text/csv;charset=utf-8")))))));
}

// Tabla de variación por entidades: un delito, las 32 entidades ordenadas
// de mayor a menor en el periodo elegido (el "ranking" de la plataforma).
async function vistaRanking(raiz, codigo) {
  const g = agrupacion();
  const d = delito(codigo);
  ajustarUnidad(d);
  const u = unidad();
  const dat = await cargarDelito(d.codigo);
  const lista = periodos(g, abs(dat[u.key].inicio));
  const cx = contextoVariacion(g, lista);

  const filas = META.entidades.slice(1)
    .map((x) => ({ x, ...valoresVariacion(serie(dat[u.key], x.codigo), cx) }))
    .sort((a, b) => (b.act ?? -Infinity) - (a.act ?? -Infinity))
    .map((f, i) => ({
      ...f,
      nombre: h("div", { class: "table-item-name" }, `${i + 1}. ${f.x.nombre}`),
      columnas: { posicion: i + 1, entidad: f.x.nombre, delito: d.nombre },
      // De la entidad, a su tabla por tipo de delito.
      irA: () => { location.href = urlDe("variacion", { ...q, crime: 0, state: f.x.codigo }); },
      irATendencia: () => { location.href = urlDe("tendencia", { ...q, crime: d.codigo, state: f.x.codigo, group: grupoTendencia(g) }); },
    }));

  raiz.append(h("div", {},
    barraFiltros([
      ["col-sm-3", selector({ titulo: "TIPO DE DELITO", opciones: opcionesDelito(), valor: d.codigo, onCambio: (v) => { location.href = urlDe(`variacion/${v}`, { ...q, crime: v }); } })],
      ["col-sm-2", selector({ titulo: "UNIDAD DE OBSERVACIÓN", opciones: opcionesUnidad(), valor: q.unit, onCambio: (v) => cambiar({ unit: v, period: "" }) })],
      ["col-sm-2", selector({ titulo: "INDICADOR", opciones: INDICADORES, valor: q.indicator, onCambio: (v) => cambiar({ indicator: v }) })],
      ["col-sm-2", selector({ titulo: "PERÍODO", opciones: opcionesPeriodo(lista), valor: cx.per.clave, onCambio: (v) => cambiar({ period: v }) })],
      ["col-sm-3", selector({ titulo: "AGRUPACIÓN", opciones: opcionesAgrupacion(), valor: g.value, onCambio: (v) => cambiar({ group: v, period: "" }) })],
    ], { regresar: true }),
    h("div", { class: "container mt-5" }, h("div", { class: "row" }, h("div", { class: "col col-12" },
      h("div", { class: "d-flex align-items-center", style: { position: "relative" } },
        botonRegresar("hidden-xs btn-back btn btn-black py-2 px-3 decoration-none left w-auto d-flex align-items-center"),
        h("div", { class: "w-100" }, h("h2", { class: "text-center m-0" }, "Tabla de Variación Por Entidades"), h("p", { class: "text-center mb-4 mt-2" }, d.nombre)),
        iconoDelito(d.codigo, "right")),
      tablaVariacion({ columna: "Entidad", cx, filas }),
      botonDescargar(() => bajar(`ranking_${d.codigo}_${cx.per.clave}.csv`, csvDe(csvVariacion(cx, filas)), "text/csv;charset=utf-8")))))));
}

// /ranking/<estado>: un delito, los municipios del estado de mayor a menor.
async function vistaRankingMunicipal(raiz, ent) {
  const g = agrupacion();
  const d = delito(q.crime);
  ajustarUnidad(d);
  const u = unidad();
  const [indice, dat] = await Promise.all([cargarIndiceMpal(ent.codigo), cargarDelitoMpal(ent.codigo, d.codigo)]);
  const um = dat[u.key];
  const lista = periodos(g, um ? abs(um.inicio) : abs("2015-01"));
  const cx = contextoVariacion(g, lista);

  const filas = indice.municipios
    .map((m, i) => ({ m, ...valoresVariacion(um ? serie(um, i) : null, cx) }))
    .sort((a, b) => (b.act ?? -Infinity) - (a.act ?? -Infinity))
    .map((f, i) => ({
      ...f,
      nombre: h("div", { class: "table-item-name" }, `${i + 1}. ${f.m.nombre}`),
      columnas: { posicion: i + 1, municipio: f.m.nombre, entidad: ent.nombre, delito: d.nombre },
      // Del municipio, a su tabla por tipo de delito.
      irA: () => { location.href = urlDe("variacion", { ...q, crime: 0, state: ent.codigo, municipality: f.m.codigo }); },
      irATendencia: () => { location.href = urlDe(`tendencia/${ent.slug}`, { ...q, crime: d.codigo, states: `0,${f.m.codigo}`, group: grupoTendencia(g) }); },
    }));

  raiz.append(h("div", {},
    barraFiltros([
      ["col-sm-3", selector({ titulo: "TIPO DE DELITO", opciones: opcionesDelito(), valor: d.codigo, onCambio: (v) => cambiar({ crime: v }) })],
      ["col-sm-3", selector({ titulo: "UNIDAD DE OBSERVACIÓN", opciones: opcionesUnidad(), valor: q.unit, onCambio: (v) => cambiar({ unit: v, period: "" }) })],
      ["col-sm-2", selector({ titulo: "INDICADOR", opciones: INDICADORES, valor: q.indicator, onCambio: (v) => cambiar({ indicator: v }) })],
      ["col-sm-2", selector({ titulo: "PERÍODO", opciones: opcionesPeriodo(lista), valor: cx.per.clave, onCambio: (v) => cambiar({ period: v }) })],
      ["col-sm-2", selector({ titulo: "AGRUPACIÓN", opciones: opcionesAgrupacion(), valor: g.value, onCambio: (v) => cambiar({ group: v, period: "" }) })],
    ], { regresar: true }),
    h("div", { class: "container mt-5" }, h("div", { class: "row" }, h("div", { class: "col col-12" },
      h("div", { class: "d-flex align-items-center", style: { position: "relative" } },
        botonRegresar("hidden-xs btn-back btn btn-black py-2 px-3 decoration-none left w-auto d-flex align-items-center"),
        h("div", { class: "w-100" }, h("h2", { class: "text-center m-0" }, `Ranking Municipal ${ent.nombre}`), h("p", { class: "text-center mb-4 mt-2" }, d.nombre)),
        iconoDelito(d.codigo, "right")),
      d.mpal ? null : h("p", { class: "text-center aviso-datos" }, `El SESNSP no publica ${d.nombre.toLowerCase()} a nivel municipal.`),
      tablaVariacion({ columna: "Municipio", cx, filas }),
      botonDescargar(() => bajar(`ranking_${ent.slug}_${d.codigo}_${cx.per.clave}.csv`, csvDe(csvVariacion(cx, filas)), "text/csv;charset=utf-8")))))));
}

// ── Comparar delitos ────────────────────────────────────────────────────────
// Varios delitos en una misma gráfica, para un mismo lugar. Es descriptiva:
// muestra las series juntas, sin interpretarlas. Los delitos pueden estar
// contenidos unos en otros (las tablas son referenciales): se comparan, no se suman.
const COMPARACIONES = [
  { nombre: "Feminicidio y homicidio doloso de mujeres", delitos: [1120, 1130], unit: "victims" },
  { nombre: "Homicidio doloso y otros delitos contra la vida", delitos: [1100, 1009], unit: "folders" },
  { nombre: "Homicidio doloso: sin feminicidio y feminicidio", delitos: [1100, 1110, 1120], unit: "folders" },
  { nombre: "Homicidio doloso total y con arma de fuego", delitos: [1100, 1101], unit: "folders" },
  { nombre: "Secuestro y otros delitos contra la libertad", delitos: [2000, 2009], unit: "folders" },
  { nombre: "Robo a transeúnte: vía pública y transporte", delitos: [4400, 4410, 4420], unit: "folders" },
];
// Colores por orden de selección: los componentes comparten color con su
// delito, así que aquí no sirve el color de cada delito.
const PALETA_COMPARAR = ["#43AB34", "#E39309", "#38BDE6", "#E624EC", "#EB4337"];

async function vistaComparar(raiz) {
  const g = agrupacion().n === 0 ? AGRUPACIONES[0] : agrupacion();
  const e = Math.max(0, Math.min(32, Number(q.state.split(",")[0]) || 0));
  const validos = new Set(META.delitos.map((d) => d.codigo));
  let sel = [...new Set(q.crimes.split(",").filter(Boolean).map(Number).filter((c) => validos.has(c)))].slice(0, 5);
  if (!sel.length) { sel = COMPARACIONES[0].delitos; if (!q.crimes) q.unit = COMPARACIONES[0].unit; }
  const datos = await cargarEntidad(e);
  const u = unidad();

  const inicios = sel.map((c) => datos.delitos[c]?.[u.key]?.inicio).filter(Boolean).map(abs);
  const lista = periodos(g, inicios.length ? Math.min(...inicios) : abs("1997-01")).reverse();
  const series = sel.map((c, i) => {
    const d = delito(c), uo = datos.delitos[c]?.[u.key];
    return { nombre: uo ? d.nombre : `${d.nombre} (no se publica en ${u.name.toLowerCase()})`, color: PALETA_COMPARAR[i], pts: lista.map((p) => suma(serie(uo), p.k0, p.k1)) };
  });

  const sugeridas = h("div", { class: "comparaciones" },
    h("label", { class: "title-select" }, "Comparaciones sugeridas"),
    COMPARACIONES.map((c) => {
      const activa = c.delitos.join(",") === sel.join(",");
      return h("button", { type: "button", class: `sugerida ${activa ? "activa" : ""}`,
        onclick: () => cambiar({ crimes: c.delitos.join(","), unit: c.unit }) }, c.nombre);
    }));

  raiz.append(h("div", { class: "box-height" },
    barraFiltros([
      ["col-sm-3", selector({ titulo: "ENTIDAD", valor: e, opciones: META.entidades.map((x) => ({ value: x.codigo, name: nombreEntidad(x.codigo) })), onCambio: (v) => cambiar({ state: v }) })],
      ["col-sm-3", selector({ titulo: "UNIDAD DE OBSERVACIÓN", opciones: UNIDADES, valor: q.unit, onCambio: (v) => cambiar({ unit: v }) })],
      ["col-sm-3", selector({ titulo: "INDICADOR", opciones: INDICADORES, valor: q.indicator, onCambio: (v) => cambiar({ indicator: v }) })],
      ["col-sm-3", selector({ titulo: "AGRUPACIÓN", opciones: opcionesAgrupacion(false), valor: g.value, onCambio: (v) => cambiar({ group: v }) })],
    ]),
    h("div", { class: "container-fluid mt-5" }, h("div", { class: "row align-items-stretch" },
      h("div", { class: "col col-12 mt-2 col-md-9" },
        h("div", { class: "w-100 text-center" }, h("h2", { class: "text-center" }, "Comparar delitos"), h("p", { class: "text-center" }, nombreEntidad(e))),
        h("div", { class: "leyenda-comparar" }, series.map((se) => h("span", {}, h("i", { style: { background: se.color } }), se.nombre))),
        h("div", { id: "multilinechart" }),
        h("p", { class: "nota-comparar" }, "Algunos delitos están contenidos en otros (por ejemplo, el feminicidio forma parte del homicidio doloso): las series se comparan, no se suman."),
        botonDescargar(() => descargarSeries(`comparar_${e}.csv`, { nombre: "varios" }, lista, series))),
      h("div", { class: "col col-12 mt-2 mb-2 col-md-3" },
        h("div", {}, sugeridas,
          sidebarSeleccion({
            etiqueta: "Delitos seleccionados:", sel, max: 5,
            items: META.delitos.map((d) => ({ clave: d.codigo, nombre: d.nombre, nivel: d.padre ? 1 : 0, color: sel.includes(d.codigo) ? PALETA_COMPARAR[sel.indexOf(d.codigo)] : null })),
            alCambiar: (nuevo) => cambiar({ crimes: nuevo.join(",") }),
          })))))));
  return () => graficaLineas($("#multilinechart"), lista, series, g);
}

// ── Descargar datos ─────────────────────────────────────────────────────────
async function vistaDescargar(raiz) {
  const g = agrupacion();
  const todos = "todos";
  const crime = q.crime === todos ? todos : delito(q.crime).codigo;
  const est = q.state === todos ? todos : Math.max(0, Math.min(32, Number(q.state) || 0));
  const lista = periodos(g);
  const per = q.period === todos ? null : periodoActual(lista);
  const delitosSel = crime === todos ? META.delitos : [delito(crime)];
  const entidadesSel = est === todos ? META.entidades : [entidad(est)];
  const periodosSel = per ? [per] : lista;
  // Cada delito arranca cuando el SESNSP empezó a publicarlo (feminicidio en
  // 2015, por ejemplo); antes de eso no hay registro que descargar.
  const periodosDe = (d) => periodosSel.filter((p) => p.k0 >= abs(d.ci_desde));
  const registros = (ents) => delitosSel.reduce((n, d) => n + periodosDe(d).length * ents, 0);
  const total = registros(entidadesSel.length);
  let busqueda = "";

  const filtrosNombre = [
    crime === todos ? "Todos los delitos" : delito(crime).nombre,
    est === todos ? "Todas las entidades" : nombreEntidad(est),
    g.name,
    per ? per.largo : "Todos los periodos",
  ];

  async function filas() {
    const out = [];
    const texto = busqueda.trim().toLowerCase();
    for (const d of delitosSel) {
      const dat = await cargarDelito(d.codigo);
      for (const x of entidadesSel) {
        if (texto && !`${x.nombre} ${d.nombre}`.toLowerCase().includes(texto)) continue;
        for (const p of [...periodosDe(d)].reverse()) {
          const val = (u, k) => {
            const v = dat[u] ? suma({ inicio: abs(dat[u].inicio), arr: dat[u][k][x.codigo] }, p.k0, p.k1) : null;
            return v == null ? null : +v.toFixed(k === "t" ? 4 : 0);
          };
          out.push({
            inegiEntidad: x.codigo, inegiEntidadName: x.nombre, typeCrime: d.codigo, typeCrimeName: d.nombre,
            group: g.value, period: p.largo, date: ym(p.k1),
            researchFolders: val("ci", "c"), researchFoldersRate: val("ci", "t"),
            victimCase: val("v", "c"), victimRate: val("v", "t"),
          });
        }
      }
    }
    return out;
  }
  const bajarCSV = async () => {
    bajar("delitosmexico.csv", csvDe(await filas()), "text/csv;charset=utf-8");
  };
  const bajarJSON = async () => bajar("delitosmexico.json", JSON.stringify(await filas()), "application/json");

  const formato = (nombre, texto, accion, href) => h("div", { class: "table-item td-opacity", style: { fontSize: "13px" } },
    h("div", { class: "table-item-description" }, h("div", { class: "table-item-name d-flex align-items-center" }, h("span", { class: "material-icons mr-2" }, "arrow_downward"), nombre)),
    h("div", { class: "px-3 flex-shrink-0", style: { fontSize: "12px", minWidth: "200px", textAlign: "center" } },
      href ? h("a", { class: "green-color pointer text-underline", href, download: "" }, texto)
        : accion ? h("a", { class: "green-color pointer text-underline", onclick: accion }, texto)
          : h("span", { class: "muted-color" }, texto)));

  const conteo = h("label", { class: "d-block my-2" }, `${NF0.format(total)} registros`);
  raiz.append(h("div", { class: "container download-section" },
    h("div", { class: "row" }, h("div", { class: "col-12" },
      h("h2", { class: "text-center", style: { marginTop: "1.5rem" } }, "Descargar bases de datos"),
      h("p", { class: "text-center" }, "En esta sección podrás obtener nuestras bases de datos. En la parte derecha encontrarás filtros con los que podrás seleccionar la temporalidad, el espacio geográfico y los delitos de tu interés, mientras que en la parte de abajo podrás elegir el formato que más se adecue a tus necesidades, para su descarga."))),
    h("div", { class: "row reverse-mobile" },
      h("div", { class: "col col-12 mt-2 col-md-9" }, h("div", { class: "box-content box-content-opacity mb-5 pb-5" },
        h("div", {}, filtrosNombre.map((t) => h("div", { class: "item-filter" }, h("span", { class: "name" }, t)))),
        h("div", { class: "d-block d-md-flex align-items-center justify-content-between w-100 my-2" },
          h("h2", { class: "my-0" }, "Formatos de archivo plano"),
          h("a", { class: "btn btn-black btn-medium mx-2 d-flex align-items-center justify-content-center px-4 my-2 my-md-0", href: `${RAIZ}nota-metodologica/` }, "DESCARGAR METADATOS")),
        h("hr", { class: "my-2" }),
        h("div", { class: "table-wrapper-mobile" }, formato("CSV", "Descargar todos los datos", bajarCSV), formato("JSON", "Descargar todos los datos", bajarJSON)),
        h("div", { class: "d-flex align-items-center justify-content-between w-100" }, h("h2", { class: "my-0" }, "Formatos de archivo geográfico")),
        h("hr", { class: "my-2" }),
        h("div", { class: "table-wrapper-mobile" },
          formato("GEOJSON", "Descargar todas las entidades", null, `${RAIZ}descargas/estados.geojson`),
          formato("GEOJSON", "Descargar todos los municipios", null, `${RAIZ}descargas/municipios.geojson`)))),
      h("div", { class: "col col-12 mt-2 mb-2 col-md-3" }, h("div", { class: "box-content box-content-sidebar py-4 mb-2" },
        h("label", { class: "mr-1" }, "FILTRAR:"), conteo,
        h("p", { class: "my-1" }, "Filtros seleccionados:"),
        h("a", { class: "d-block link mt-2 mb-2 pointer", onclick: () => cambiar({ crime: todos, state: todos, group: "month", period: todos }) }, "Limpiar todo"),
        h("label", { class: "title-select mt-3" }, "Palabras clave:"),
        h("input", { type: "text", autocomplete: "off", placeholder: "Buscar registro", class: "input-buscar",
          oninput: (ev) => {
            busqueda = ev.target.value;
            const t = busqueda.trim().toLowerCase();
            const n = !t ? total : delitosSel.reduce((acc, d) => acc + periodosDe(d).length *
              entidadesSel.filter((x) => `${x.nombre} ${d.nombre}`.toLowerCase().includes(t)).length, 0);
            conteo.textContent = `${NF0.format(n)} registros`;
          } }),
        h("div", { class: "my-2" }, selector({ titulo: "TIPO DE DELITO", valor: crime, opciones: [{ value: todos, name: "Todos los delitos" }, ...opcionesDelito()], onCambio: (v) => cambiar({ crime: v }) })),
        h("div", { class: "my-2" }, selector({ titulo: "ENTIDAD", valor: est, opciones: [{ value: todos, name: "Todas las entidades" }, ...META.entidades.map((x) => ({ value: x.codigo, name: nombreEntidad(x.codigo) }))], onCambio: (v) => cambiar({ state: v }) })),
        h("div", { class: "my-2" }, selector({ titulo: "AGRUPACIÓN", valor: g.value, opciones: opcionesAgrupacion(), onCambio: (v) => cambiar({ group: v, period: "" }) })),
        h("div", { class: "my-2" }, selector({ titulo: "PERÍODO", valor: per ? per.clave : todos, opciones: [{ value: todos, name: "Todos los periodos" }, ...opcionesPeriodo(lista)], onCambio: (v) => cambiar({ period: v }) })))))));
}

// ═══════════════════════════════════════════════════════════════════════════
// Marco común: tema, menú, pie
// ═══════════════════════════════════════════════════════════════════════════
function aplicarTema(claro) {
  document.body.classList.toggle("light", claro);
  const sw = $("#tema");
  sw.classList.toggle("rc-switch-checked", !claro);
  sw.setAttribute("aria-checked", String(!claro));
  $("#logo").src = `${RAIZ}assets/${claro ? "logo_light" : "logo"}.svg`;
  try { localStorage.setItem("tema", claro ? "claro" : "oscuro"); } catch (e) { /* sin almacenamiento */ }
}

function modalInsertar() {
  const url = new URL(location.href);
  url.searchParams.set("iframe", "1");
  const codigo = `<iframe src="${url}" width="100%" height="700" frameborder="0"></iframe>`;
  const fondo = h("div", { class: "modal-fondo", onclick: (ev) => { if (ev.target === fondo) fondo.remove(); } },
    h("div", { class: "modal" },
      h("h3", { class: "mt-0", style: { fontSize: "18px" } }, "Insertar en Sitio Web"),
      h("p", {}, "Copia este código y pégalo en tu página para mostrar esta vista:"),
      h("textarea", { readonly: true, onfocus: (ev) => ev.target.select() }, codigo),
      h("div", { class: "d-flex justify-content-end mt-3" }, h("button", { class: "btn", onclick: () => fondo.remove() }, "Cerrar"))));
  document.body.append(fondo);
}

function conectarMarco() {
  document.addEventListener("click", (ev) => {
    const a = ev.target.closest("[data-accion]");
    if (!a) return;
    const acc = a.dataset.accion;
    if (acc === "abrir-menu") $("#cabecera").classList.add("openMenu");
    if (acc === "cerrar-menu") $("#cabecera").classList.remove("openMenu");
    if (acc === "insertar") modalInsertar();
  });
  $("#tema").addEventListener("click", () => aplicarTema(!document.body.classList.contains("light")));
  for (const l of document.querySelectorAll("[data-tema]")) l.addEventListener("click", () => aplicarTema(l.dataset.tema === "claro"));
  let t;
  window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(pintar, 150); });
}

function marcarMenu() {
  for (const a of document.querySelectorAll("nav a")) {
    // El ranking municipal es parte de la tabla de variación.
    a.classList.toggle("active", a.dataset.vista === (VISTA === "ranking" ? "variacion" : VISTA));
    // Al cambiar de vista se conservan los filtros que aplican a ambas.
    if (a.dataset.vista) a.href = urlDe(a.dataset.vista, { ...DEFAULTS, unit: q.unit, indicator: q.indicator, crime: q.crime === "todos" ? "0" : q.crime });
  }
}

const VISTAS = { "": vistaInicio, tendencia: vistaTendencia, mapa: vistaMapa, variacion: vistaVariacion, comparar: vistaComparar, descargar: vistaDescargar };
let turno = 0;
async function pintar() {
  const yo = ++turno;
  tip.ocultar();
  marcarMenu();
  const raiz = $("#vista");
  if (VISTA === "nota-metodologica") { raiz.hidden = true; $("#nota").hidden = false; return; }
  const nueva = h("div");
  let despues;
  try {
    despues = VISTA === "variacion" && ARG ? await vistaRanking(nueva, ARG)
      : VISTA === "ranking" && entidadPorSlug(ARG) ? await vistaRankingMunicipal(nueva, entidadPorSlug(ARG))
      : await (VISTAS[VISTA] || vistaInicio)(nueva);
  } catch (err) {
    console.error(err);
    nueva.replaceChildren(h("p", { class: "text-center mt-5" }, "No se pudieron cargar los datos. Intenta recargar la página."));
  }
  if (yo !== turno) return;          // llegó otra selección mientras cargaba
  raiz.replaceChildren(nueva);
  if (typeof despues === "function") despues();
}

async function iniciar() {
  leerParams();
  if (q.iframe) document.body.classList.add("isIframe");
  document.body.classList.toggle("home", VISTA === "");
  conectarMarco();
  try {
    [META, MAPA] = await Promise.all([cargar("datos/meta.json"), cargar("datos/mapa.json")]);
  } catch (err) {
    $("#vista").replaceChildren(h("p", { class: "text-center mt-5" }, "No se pudieron cargar los datos. Intenta recargar la página."));
    return;
  }
  CORTE = abs(META.corte);
  aplicarTema(document.body.classList.contains("light"));
  const gen = new Date(META.generado);
  $("#pie-datos").textContent = `Datos actualizados a ${MESES_LARGO[mes(CORTE)]} de ${anio(CORTE)}, publicados el ${gen.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}. `;
  $("#pie-fuente").href = META.fuente_url;
  pintar();
}

iniciar();
