/*
 * Delitos México — Observatorio Interactivo del ONC, sitio estático.
 *
 * Conserva las vistas, rutas y parámetros de URL de la plataforma anterior
 * (unit, indicator, group, crime, state, period), pero sin servidor: todo se
 * calcula aquí a partir de los JSON que genera pipeline/sitio.py. Cada vista
 * vive en su propia carpeta (/tendencia/, /mapa/...) con una copia de la
 * misma página; el atributo data-ruta del <body> dice cuál pintar.
 *
 * Diseño: docs/plataforma/DISENO.md (filtros arriba, columna lateral que
 * explica cada vista, modo claro por omisión).
 */
"use strict";

const RAIZ = document.body.dataset.raiz || "./";
const RUTA = document.body.dataset.ruta || "";
// Cambia en cada publicación: va en la dirección de cada archivo de datos para
// que el navegador no use una copia vieja de su caché (Safari la guarda mucho).
const VERSION = document.body.dataset.version || "";
// "variacion/1100" es el ranking por entidades de un delito, como en la plataforma.
const [VISTA, ARG] = RUTA.split("/");

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// Opciones de los selectores, con los mismos valores de URL que la plataforma anterior.
const UNIDADES = [
  { value: "folders", name: "Carpetas de investigación", key: "ci", corto: "Carpetas" },
  { value: "victims", name: "Víctimas", key: "v", corto: "Víctimas" },
];
const INDICADORES = [
  { value: "researchFolders", name: "Números absolutos", key: "c" },
  { value: "researchFoldersRate", name: "Tasa por 100 mil habitantes", key: "t" },
];
const AGRUPACIONES = [
  { value: "month", name: "Mensual", n: 1, letra: "M" },
  { value: "twoMonth", name: "Bimestral", n: 2, letra: "B" },
  { value: "trimester", name: "Trimestral", n: 3, letra: "T" },
  { value: "quarter", name: "Cuatrimestral", n: 4, letra: "C" },
  { value: "semester", name: "Semestral", n: 6, letra: "S" },
  { value: "anual", name: "Anual", n: 12, letra: "A" },
  { value: "accumulated", name: "Acumulado anual", n: 0, letra: "C" },
  // Por sexenio: promedio mensual de cada gobierno (tablas, rankings y mapas).
  { value: "sexenio", name: "Por sexenio", n: -1, letra: "X" },
];

const NF2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NF1 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const NF0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

let META, MAPA, CORTE;      // CORTE = último mes con datos, en meses absolutos
const cache = new Map();
let q;                       // parámetros de la URL vigentes
let filtrosAbiertos = false; // en celular, el panel de filtros sigue abierto al repintar

// ── Utilidades ──────────────────────────────────────────────────────────────
const $ = (sel, r = document) => r.querySelector(sel);
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
  for (const c of hijos.flat(Infinity)) if (c != null && c !== false) n.append(c.nodeType ? c : String(c));
  return n;
}
const s = (tag, attrs = {}, ...hijos) => h(tag, { ...attrs, _svg: true }, ...hijos);
const esMovil = () => matchMedia("(max-width: 760px)").matches;
const oscuro = () => document.body.classList.contains("oscuro");
const sinAcentos = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Íconos de interfaz, de trazo (heredan el color del texto).
const TRAZOS = {
  abajo: "M6 9l6 6 6-6", derecha: "M9 6l6 6-6 6", palomita: "M5 12l5 5 9-10", filtros: "M4 6h16M7 12h10M10 18h4",
  descargar: "M12 4v11M7 10l5 5 5-5M5 20h14", cerrar: "M6 6l12 12M18 6L6 18", flecha: "M5 12h14M13 6l6 6-6 6",
  lupa: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.8-4.8", insertar: "M8 8l-4 4 4 4M16 8l4 4-4 4",
  libro: "M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z",
  // Los mismos trazos del menú de vistas (index.html), para Inicio.
  tendencia: "M3 17l5-6 4 4 8-9", mapa: "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14",
  variacion: "M8 20V4M4 8l4-4 4 4M16 4v16M12 16l4 4 4-4", ranking: "M5 20V11M12 20V4M19 20v-6M3 20h18", comparar: "M4 8h14l-3-3M20 16H6l3 3",
};
function ic(nombre, tam = 18) {
  return s("svg", { width: tam, height: tam, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2,
    "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" }, s("path", { d: TRAZOS[nombre] }));
}

const abs = (ymes) => { const [y, m] = ymes.split("-").map(Number); return y * 12 + m - 1; };
const anio = (k) => Math.floor(k / 12);
const mes = (k) => k % 12;
const ym = (k) => `${anio(k)}-${String(mes(k) + 1).padStart(2, "0")}`;
const mesCorto = (k) => `${MESES[mes(k)]} ${anio(k)}`;

const delito = (code) => META.delitos.find((d) => d.codigo === Number(code)) || META.delitos[0];
const entidad = (e) => META.entidades[Number(e)] || META.entidades[0];
const nombreEntidad = (e) => (Number(e) === 0 ? "Total nacional" : entidad(e).nombre);
const agrupacion = () => AGRUPACIONES.find((g) => g.value === q.group) || AGRUPACIONES[0];
const unidad = () => UNIDADES.find((u) => u.value === q.unit) || UNIDADES[0];
const indicador = () => INDICADORES.find((i) => i.value === q.indicator) || INDICADORES[1];
const esTasa = () => indicador().key === "t";
const fmt = (v) => (v == null ? "–" : esTasa() ? NF2.format(v) : NF0.format(v));
const textoIndicador = () => (esTasa() ? "Tasa por 100 mil habitantes" : `Número de ${unidad().corto.toLowerCase()}`);
const iconoDelito = (code, chico = false) => {
  const d = delito(code);
  return h("span", { class: `icono-delito ${chico ? "chico" : ""}`, "aria-hidden": "true",
    style: { backgroundColor: d.color, backgroundImage: `url(${RAIZ}assets/${d.icono ?? d.codigo}.svg)` } });
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
    cache.set(ruta, fetch(`${RAIZ}${ruta}?v=${VERSION}`).then((r) => {
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
const avisoSinMunicipal = (d) => (d.mpal ? null : h("p", { class: "aviso" }, `El SESNSP no publica ${d.nombre.toLowerCase()} a nivel municipal; se muestra solo el total del estado.`));
const cargarMunicipio = (e, m) => cargar(`datos/mpal/${e}/municipio/${m}.json`);
const cargarMapaMpal = (e) => cargar(`datos/mpal/${e}/mapa.json`);
const entidadPorSlug = (sl) => META.entidades.find((x) => x.codigo > 0 && x.slug === sl);
const conMunicipios = () => META.entidades.filter((x) => x.municipios > 0);

/** Serie {inicio, arr} de un objeto de unidad ({inicio, c, t}); `e` si trae varias. `k` fuerza el indicador. */
function serie(u, e, k = indicador().key) {
  if (!u) return null;
  const arr = u[k];
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
/** Promedio mensual de los meses k0..k1; null si falta cualquiera. */
function media(se, k0, k1) {
  const t = suma(se, k0, k1);
  return t == null ? null : t / (k1 - k0 + 1);
}
/** Valor de un periodo: la suma, o el promedio mensual si el periodo es un sexenio. */
const valorPeriodo = (se, p) => (!p ? null : p.promedio ? media(se, p.k0, p.k1) : suma(se, p.k0, p.k1));
const redondeo = (v) => (v == null ? null : +v.toFixed(esTasa() ? 4 : 0));
const variacion = (a, b) => (a == null || b == null || b === 0 ? null : ((a - b) / b) * 100);

// ── Periodos según la agrupación ────────────────────────────────────────────
/**
 * Periodos completos de la agrupación, del más reciente al más antiguo.
 * Cada uno: {k0, k1, clave, largo, corto}. `clave` va en el parámetro period.
 */
function periodos(g, desde = abs("1997-01")) {
  if (g.value === "sexenio") return periodosSexenio(desde);
  const out = [];
  const yc = anio(CORTE);
  if (g.n === 0) {
    const m = mes(CORTE);
    for (let y = yc; y * 12 >= desde; y--) {
      const rango = m === 0 ? MESES[0] : `${MESES[0]}–${MESES[m]}`;
      out.push({ k0: y * 12, k1: y * 12 + m, clave: String(y), largo: `${rango} ${y}`, corto: `${rango} ${y}` });
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
      if (g.n === 1) { largo = `${MESES_LARGO[mes(k1)]} ${y}`; corto = `${MESES[mes(k1)]} ${y}`; }
      else if (g.n === 12) { largo = corto = String(y); }
      else { largo = corto = `${p}${g.letra} ${y}`; }
      out.push({ k0, k1, clave: ym(k1), largo, corto });
    }
  }
  return out;
}
/**
 * Sexenios con datos para todo su periodo (el de curso, hasta el corte), del
 * más reciente al más antiguo. Zedillo queda fuera: los datos empiezan en 1997.
 */
function periodosSexenio(desde) {
  return SEXENIOS.filter((x) => x.k0 >= Math.max(desde, abs("1997-01")) && x.k0 <= CORTE).map((x) => {
    const curso = x.k1 > CORTE, k1 = Math.min(x.k1, CORTE), n = k1 - x.k0 + 1;
    const rango = `${mesCorto(x.k0)}–${mesCorto(k1)}`;
    return { k0: x.k0, k1, n, curso, sexenio: x, promedio: true, clave: x.clave, corto: x.nombre,
      largo: curso ? `sexenio de ${x.nombre} (${n} meses, ${rango})` : `sexenio de ${x.nombre} (${rango})` };
  }).reverse();
}
/** El periodo elegido en la URL, o el más reciente. */
const periodoActual = (lista) => lista.find((p) => p.clave === q.period) || lista[0];
const mayus = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// ── URL ─────────────────────────────────────────────────────────────────────
// `states` son los municipios elegidos en /tendencia/<estado> (0 = total del
// estado) y `municipality` el de la tabla de variación, como en la plataforma.
// `desde` y `hasta` (AAAA-MM) guardan el tramo elegido en las gráficas.
const DEFAULTS = { unit: "folders", indicator: "researchFoldersRate", group: "month", crime: "0", state: "0", period: "", states: "0", municipality: "0", crimes: "", desde: "", hasta: "", sexenios: "" };
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
  for (const [k, v] of Object.entries(params)) if (k in DEFAULTS && v !== "" && v != null) p.set(k, v);
  const qs = p.toString();
  return `${RAIZ}${ruta ? ruta + "/" : ""}${qs ? "?" + qs : ""}`;
}
function urlActual() {
  const u = urlDe(RUTA, q);
  return q.iframe ? `${u}${u.includes("?") ? "&" : "?"}iframe=1` : u;
}
function cambiar(cambios) {
  Object.assign(q, cambios);
  history.replaceState(null, "", urlActual());
  pintar();
}
// Cambiar delito o agrupación invalida el tramo elegido en la gráfica.
const sinTramo = { desde: "", hasta: "" };

// ── Selectores ──────────────────────────────────────────────────────────────
let abierto = null;
function cerrarLista() { abierto?.cerrar(); abierto = null; }
/** Lista desplegable anclada a `ancla`; en celular sale como hoja inferior. */
function abrirLista({ ancla, titulo, opciones, valor, onElegir, buscar, multiple }) {
  cerrarLista();
  const capa = h("div", { class: "capa", onclick: cerrarLista });
  const items = opciones.map((o) => {
    const on = multiple ? valor.includes(o.value) : String(o.value) === String(valor);
    return h("button", {
      type: "button", role: "option", class: `op ${on ? "on" : ""}`, "aria-selected": String(on), disabled: o.disabled, title: o.title,
      style: o.nivel ? { paddingLeft: `${16 + 18 * o.nivel}px` } : null, "data-t": sinAcentos(o.name),
      onclick: () => { cerrarLista(); onElegir(o.value); },
    }, multiple ? h("span", { class: "marca-op" }, on ? ic("palomita", 14) : null) : null, o.name);
  });
  const filtro = buscar ? h("input", { type: "search", placeholder: "Buscar", "aria-label": `Buscar en ${titulo.toLowerCase()}`,
    oninput: (ev) => { const t = sinAcentos(ev.target.value.trim()); for (const it of items) it.hidden = t && !it.dataset.t.includes(t); } }) : null;
  const lista = h("div", { class: "lista-sel", role: "listbox", "aria-label": titulo,
    onkeydown: (ev) => { if (ev.key === "Escape") { cerrarLista(); ancla.focus(); } } },
    h("div", { class: "titulo-lista" }, titulo), filtro, items);
  if (!esMovil()) {
    const r = ancla.getBoundingClientRect();
    Object.assign(lista.style, { top: `${r.bottom + scrollY + 4}px`, left: `${Math.min(r.left + scrollX, innerWidth - 300)}px`, minWidth: `${Math.max(r.width, 280)}px` });
  }
  document.body.append(capa, lista);
  ancla.setAttribute("aria-expanded", "true");
  abierto = { cerrar: () => { capa.remove(); lista.remove(); ancla.setAttribute("aria-expanded", "false"); } };
  lista.querySelector(".on")?.scrollIntoView({ block: "nearest" });
  (filtro && !esMovil() ? filtro : lista.querySelector(".op.on") || lista.querySelector(".op"))?.focus();
}
function selector({ titulo, opciones, valor, onCambio, deshabilitado = false, buscar }) {
  const actual = opciones.find((o) => String(o.value) === String(valor));
  const boton = h("button", { type: "button", "aria-haspopup": "listbox", "aria-expanded": "false", disabled: deshabilitado },
    h("small", {}, titulo), h("span", { class: "valor" }, h("span", {}, actual ? actual.name : (opciones[0]?.name ?? "")), ic("abajo", 16)));
  boton.addEventListener("click", () => abrirLista({ ancla: boton, titulo, opciones, valor,
    // Los valores viajan como texto, igual que los lee la URL.
    buscar: buscar ?? opciones.length > 15, onElegir: (v) => { if (String(v) !== String(valor)) onCambio(String(v)); } }));
  return h("div", { class: `sel ${deshabilitado ? "deshabilitado" : ""}` }, boton);
}

const opcionesDelito = () => META.delitos.map((d) => ({ value: d.codigo, name: d.nombre, nivel: d.padre ? 1 : 0 }));
const opcionesUnidad = () => {
  const d = delito(q.crime);
  return UNIDADES.map((u) => {
    const falta = u.key === "v" ? !d.v_desde : !d.ci_desde;
    return { ...u, disabled: falta, title: falta ? (u.key === "v" ? "El SESNSP no publica víctimas de este delito" : "Este delito solo se publica en víctimas") : null };
  });
};
const opcionesPeriodo = (lista) => lista.map((p) => ({ value: p.clave, name: mayus(p.largo) }));
// Tendencia y Comparar no usan el acumulado ni el sexenio; Descargar, no el sexenio.
const opcionesAgrupacion = (conAcumulado = true, conSexenio = conAcumulado) =>
  AGRUPACIONES.filter((g) => (conAcumulado || g.n !== 0) && (conSexenio || g.value !== "sexenio"));
const opcionesEntidad = () => META.entidades.map((x) => ({ value: x.codigo, name: nombreEntidad(x.codigo) }));

/** Barra de filtros arriba; en celular, un resumen con botón que la despliega. */
function barraFiltros(celdas, resumen) {
  const filtros = h("div", { class: `filtros ${filtrosAbiertos ? "abierto" : ""}`, id: "filtros" }, celdas.filter(Boolean));
  const boton = h("button", { type: "button", class: "btn", "aria-expanded": String(filtrosAbiertos), "aria-controls": "filtros",
    onclick: () => { filtrosAbiertos = filtros.classList.toggle("abierto"); boton.setAttribute("aria-expanded", String(filtrosAbiertos)); } },
    ic("filtros"), "Filtros");
  return [h("div", { class: "ctx-movil" }, h("div", {}, h("b", {}, resumen[0]), h("small", {}, resumen[1])), boton), filtros];
}

// ── Marco de cada vista ─────────────────────────────────────────────────────
/** `ancha`: la vista es una tabla ancha; la columna lateral baja antes que en las demás. */
function marco({ filtros, miga, titulo, sub, princ, lateral, lateralPrimero = false, ancha = false }) {
  return h("div", {}, filtros || [],
    h("div", { class: "contenido" },
      h("div", { class: "titulo" }, miga ? h("nav", { class: "miga", "aria-label": "Ruta" }, miga) : null, h("h1", {}, titulo), sub ? h("p", { class: "sub" }, sub) : null),
      h("div", { class: `dos-col ${lateralPrimero ? "lateral-primero" : ""} ${ancha ? "ancha" : ""}` }, h("div", { class: "princ" }, princ), lateral ? h("aside", { class: "lateral" }, lateral) : null)));
}
const caja = (etq, ...hijos) => h("section", { class: "caja" }, h("h2", { class: "etq" }, etq), hijos);
const leer = (titulo, ...parrafos) => caja(titulo, parrafos.filter(Boolean).map((p) => h("p", {}, p)));
function usarDatos(alDescargar) {
  return caja("Usar estos datos",
    alDescargar ? h("button", { type: "button", class: "enlace", onclick: alDescargar }, "Descargar CSV", ic("descargar", 16)) : null,
    h("button", { type: "button", class: "enlace", onclick: modalInsertar }, "Insertar en tu nota", h("span", { "aria-hidden": "true" }, "</>")),
    h("a", { class: "enlace", href: `${RAIZ}nota-metodologica/` }, "Nota metodológica", ic("flecha", 16)),
    h("p", { class: "nota" }, `Fuente: SESNSP, fuero común. Corte a ${MESES_LARGO[mes(CORTE)]} ${anio(CORTE)}.`));
}
const miga = (...pasos) => pasos.flatMap((p, i) => [i ? " › " : null, p.href ? h("a", { href: p.href }, p.texto) : h("span", {}, p.texto)]);
const segmento = (botones, clase = "") => h("div", { class: `seg ${clase}`, role: "group" }, botones);

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
const bajarCSV = (nombre, filas) => bajar(nombre, csvDe(filas), "text/csv;charset=utf-8");

// ── Escalas ─────────────────────────────────────────────────────────────────
/** Paso "bonito" (1, 2 o 5 × 10^n) para unas `n` marcas entre min y max. */
function pasoBonito(rango, n) {
  const crudo = rango / n;
  let paso = 10 ** Math.floor(Math.log10(crudo));
  const err = crudo / paso;
  if (err >= Math.sqrt(50)) paso *= 10;
  else if (err >= Math.sqrt(10)) paso *= 5;
  else if (err >= Math.sqrt(2)) paso *= 2;
  return paso;
}
/**
 * Dominio del eje Y: no empieza en cero si eso aplasta la serie, pero sí
 * cuando los datos ya están cerca de cero.
 */
function escalaY(min, max, n) {
  if (!(max > min)) { max = (max || 0) + 1; min = Math.max(0, min - 1); }
  let y0 = min - (max - min) * 0.6 <= 0 ? 0 : min;
  const paso = pasoBonito(max - y0, n);
  y0 = Math.floor(y0 / paso) * paso;
  const y1 = Math.ceil(max / paso) * paso;
  const ticks = [];
  for (let v = y0; v <= y1 + paso * 1e-9; v += paso) ticks.push(+v.toFixed(10));
  return { y0, y1, paso, ticks };
}
function fmtEje(v, paso) {
  const dec = paso >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(paso)));
  return v >= 1000 && paso >= 1 ? NF0.format(v) : v.toFixed(dec);
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

// Rojos del mapa por clase. En oscuro el rojo se intensifica con la tasa.
const RAMPA_CLARO = ["#f6dcd8", "#eba69e", "#dc6f63", "#c43e32", "#8f1f17"];
const RAMPA_OSCURO = ["#5b3d55", "#8b4255", "#b94a50", "#df5d4f", "#ff8a6a"];
// Colores de las series por orden de selección.
const PALETA_CLARO = ["#2e8a22", "#2f6fd6", "#e07b00", "#8e44ad", "#d6336c", "#00897b", "#795548", "#3949ab", "#9e9d24", "#546e7a"];
const PALETA_OSCURO = ["#5cc84a", "#6fa0ff", "#ffa24a", "#c08bff", "#ff7aa8", "#4fd1c5", "#c8a27c", "#8c9eff", "#d4e157", "#90a4ae"];
const colorSerie = (i) => (oscuro() ? PALETA_OSCURO : PALETA_CLARO)[i % 10];

// ═══════════════════════════════════════════════════════════════════════════
// Piezas
// ═══════════════════════════════════════════════════════════════════════════

// ── Mapa coroplético ────────────────────────────────────────────────────────
/** Clases por rupturas naturales de Jenks. `geo` = {ancho, alto, trazos: {clave: d}}. */
function clasificar(vals) {
  const cortes = vals.length ? jenks(vals, Math.min(5, new Set(vals).size || 1)) : [0, 0];
  const n = Math.max(1, cortes.length - 1);
  const rampa = oscuro() ? RAMPA_OSCURO : RAMPA_CLARO;
  const tonos = n === 1 ? [rampa[3]] : Array.from({ length: n }, (_, i) => rampa[Math.round((i * 4) / (n - 1))]);
  const claseDe = (v) => { for (let c = 1; c <= n; c++) if (v <= cortes[c] + 1e-9) return c - 1; return n - 1; };
  return { cortes, n, tonos, color: (v) => (v == null ? "var(--vacio)" : tonos[claseDe(v)]) };
}
function mapaCoropletico({ geo, valor, nombre, onClick, etiqueta, pista }) {
  const claves = Object.keys(geo.trazos).map(Number);
  const cls = clasificar(claves.map(valor).filter((v) => v != null));
  const svg = s("svg", { viewBox: `0 0 ${geo.ancho} ${geo.alto}`, role: "img", "aria-label": etiqueta });
  for (const clave of claves) {
    const v = valor(clave);
    const p = s("path", { d: geo.trazos[clave], fill: cls.color(v), stroke: "var(--borde-mapa)", "stroke-width": 0.8, "vector-effect": "non-scaling-stroke" });
    p.addEventListener("pointermove", (ev) => tip.mostrar(ev, [h("b", {}, nombre(clave)), h("div", {}, `${fmt(v)}${esTasa() ? " por 100 mil hab." : ""}`), pista ? h("div", { style: { opacity: 0.8 } }, pista) : null].filter(Boolean)));
    p.addEventListener("pointerleave", tip.ocultar);
    if (onClick) p.addEventListener("click", () => { tip.ocultar(); onClick(clave); });
    svg.append(p);
  }
  return { svg: h("div", { class: "mapa-caja" }, svg), cls };
}
const geoEstados = () => ({ ancho: MAPA.ancho, alto: MAPA.alto, trazos: Object.fromEntries(Object.entries(MAPA.estados).map(([k, v]) => [k, v.d])) });
function leyenda(cls) {
  const corto = (v) => (v >= 100 ? NF0.format(v) : fmt(v));
  return h("div", { class: "leyenda" }, h("span", {}, esTasa() ? "Tasa por 100 mil hab." : unidad().corto),
    cls.tonos.map((t, i) => h("span", {}, h("i", { style: { background: t } }), `${corto(cls.cortes[i])}–${corto(cls.cortes[i + 1])}`)));
}

/**
 * Distribución: cada entidad es un punto sobre el eje del indicador, con el
 * color de su clase en el mapa; la referencia (nacional) va punteada.
 */
function distribucion({ items, cls, referencia, onClick }) {
  // Ancho de la columna principal (se pinta antes de insertarse en la página).
  const W = esMovil() ? innerWidth - 32 : Math.max(420, Math.min(980, innerWidth - 494));
  const r = esMovil() ? 6 : 7, m = { l: 14, r: 24 };
  const vals = items.map((x) => x.valor).filter((v) => v != null);
  if (!vals.length) return null;
  const max = Math.max(...vals, referencia?.valor ?? 0);
  const paso = pasoBonito(max, esMovil() ? 4 : 8);
  const tope = Math.ceil(max / paso) * paso;
  const X = (v) => m.l + (v / tope) * (W - m.l - m.r);
  const puestos = [];
  const orden = items.filter((x) => x.valor != null).sort((a, b) => a.valor - b.valor);
  for (const x of orden) {
    const cx = X(x.valor);
    let k = 0;
    for (let i = 0; i < 40; i++) {
      const c = i === 0 ? 0 : (i % 2 ? -1 : 1) * Math.ceil(i / 2);
      if (!puestos.some((p) => p.k === c && Math.abs(p.x - cx) < 2 * r + 1)) { k = c; break; }
    }
    puestos.push({ x: cx, k, item: x });
  }
  const kmax = Math.max(1, ...puestos.map((p) => Math.abs(p.k)));
  const medio = 30 + kmax * (2 * r + 1), eje = medio + kmax * (2 * r + 1) + r + 10, H = eje + 26;
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Distribución de las entidades por valor" });
  for (let v = 0; v <= tope + paso * 1e-9; v += paso) {
    svg.append(s("line", { x1: X(v), x2: X(v), y1: eje, y2: eje + 5, stroke: "var(--eje)" }),
      s("text", { x: X(v), y: eje + 19, "text-anchor": "middle", "font-size": 12, fill: "var(--texto2)" }, fmtEje(v, paso)));
  }
  svg.append(s("line", { x1: m.l, x2: W - m.r, y1: eje, y2: eje, stroke: "var(--eje)" }));
  if (referencia?.valor != null) {
    const xr = X(referencia.valor);
    svg.append(s("line", { x1: xr, x2: xr, y1: 14, y2: eje, stroke: "var(--texto)", "stroke-dasharray": "3 4" }),
      s("text", { x: xr + 6, y: 12, "font-size": 12, fill: "var(--texto)" }, `${referencia.nombre} ${fmt(referencia.valor)}`));
  }
  // Nombres de los tres valores más altos, si no se enciman.
  const etiquetados = [];
  for (const p of [...puestos].sort((a, b) => b.item.valor - a.item.valor).slice(0, 3)) {
    const cy = medio + p.k * (2 * r + 1);
    if (etiquetados.some((e) => Math.abs(e.x - p.x) < 90 && Math.abs(e.y - cy) < 16)) continue;
    etiquetados.push({ x: p.x, y: cy });
  }
  for (const p of puestos) {
    const cy = medio + p.k * (2 * r + 1);
    const c = s("circle", { cx: p.x, cy, r, fill: cls.color(p.item.valor), stroke: "var(--texto2)", "stroke-width": 0.6 });
    c.addEventListener("pointermove", (ev) => tip.mostrar(ev, [h("b", {}, p.item.nombre), h("div", {}, fmt(p.item.valor))]));
    c.addEventListener("pointerleave", tip.ocultar);
    if (onClick) c.addEventListener("click", () => { tip.ocultar(); onClick(p.item.clave); });
    svg.append(c);
    if (etiquetados.some((e) => e.x === p.x && e.y === cy)) svg.append(s("text", { x: p.x, y: cy - r - 5, "text-anchor": "middle", "font-size": 12, fill: "var(--texto)" }, p.item.nombre));
  }
  return h("div", { class: "distribucion" }, svg);
}

/** Lista "mayor valor": las primeras `n`, con barra y la referencia al final. */
function listaMayor(items, n, referencia, href) {
  const orden = items.filter((x) => x.valor != null).sort((a, b) => b.valor - a.valor).slice(0, n);
  const max = Math.max(...orden.map((x) => x.valor), referencia?.valor ?? 0) || 1;
  const fila = (x, i, ref) => h(x.href ? "a" : "div", { class: `it ${ref ? "ref" : ""}`, href: x.href },
    h("span", { class: "rk" }, ref ? "" : i + 1), h("span", {}, x.nombre),
    h("div", { class: "barra-rank", style: { width: `${((x.valor / max) * 100).toFixed(1)}%` } }), h("span", { class: "v" }, fmt(x.valor)));
  return h("div", { class: "lista" }, orden.map((x, i) => fila(x, i)), referencia ? fila(referencia, 0, true) : null,
    href ? h("a", { class: "btn", href, style: { marginTop: "12px", width: "100%" } }, "Ver el ranking completo") : null);
}

// ── Celdas de variación ─────────────────────────────────────────────────────
const claseVar = (v) => (v == null || v === 0 ? "igual" : v < 0 ? "baja" : "sube");
const pctTexto = (v, flecha = false) => (v == null ? "n.d." : (flecha ? (v > 0 ? "▲ " : v < 0 ? "▼ " : "") : (v > 0 ? "+" : v < 0 ? "−" : "")) + NF1.format(Math.abs(v)) + "%");
function celdaVar(v) {
  const w = v == null ? 0 : Math.min(Math.abs(v) / 40, 1) * 50;
  const barra = v == null ? null : h("div", { class: "va", style: {
    left: `${v < 0 ? 50 - w : 50}%`, width: `${Math.max(w, 0.6)}%`, background: `var(${v < 0 ? "--barra-baja" : v > 0 ? "--barra-sube" : "--eje"})` } });
  return h("div", { class: "var col-web" }, h("div", { class: "pista" }, h("div", { class: "cero" }), barra), h("div", { class: `pct ${claseVar(v)}` }, pctTexto(v)));
}
function chispa(vals) {
  const W = 100, H = 28;
  const v = vals.filter((x) => x != null);
  if (v.length < 2) return s("svg", { width: W, height: H });
  const min = Math.min(...v), max = Math.max(...v);
  let dd = "", pen = false;
  vals.forEach((x, i) => {
    if (x == null) { pen = false; return; }
    const px = 2 + (i / (vals.length - 1)) * (W - 4), py = H - 3 - ((x - min) / (max - min || 1)) * (H - 6);
    dd += `${pen ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`; pen = true;
  });
  return s("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Tendencia reciente" },
    s("path", { d: dd, fill: "none", stroke: "var(--acento)", "stroke-width": 1.5, "stroke-linejoin": "round" }));
}

/**
 * Contexto de comparación para la tabla de variación: el periodo elegido, el
 * mismo periodo del año pasado y el periodo inmediato anterior.
 */
function contextoVariacion(g, lista) {
  if (g.value === "sexenio") return contextoSexenio(lista);
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
/**
 * Por sexenio: el elegido contra el anterior y el de antes, en promedio
 * mensual porque no duran lo mismo (López Obrador, 70 meses). Si el elegido va
 * en curso, se comparan sus N meses con los primeros N de cada uno.
 */
function contextoSexenio(lista) {
  const per = periodoActual(lista);
  const i = SEXENIOS.indexOf(per.sexenio);
  const ventana = (x) => (x ? { k0: x.k0, k1: per.curso ? x.k0 + per.n - 1 : x.k1, corto: x.nombre, promedio: true } : null);
  const pasado = ventana(SEXENIOS[i - 1]), anterior = ventana(SEXENIOS[i - 2]);
  const historia = SEXENIOS.slice(0, i + 1).filter((x) => x.k0 >= abs("1997-01")).map((x) => (x === per.sexenio ? per : ventana(x)));
  return {
    per, pasado, anterior, conAnterior: !!anterior, etPasado: pasado?.corto ?? "", historia,
    sexenio: true, cronologico: true,
    etiquetas: { pas: "Contra el sexenio anterior", ant: "Contra dos sexenios antes" },
    csv: { pas: "var_sexenio_anterior", ant: "var_dos_sexenios_antes" },
  };
}
function valoresVariacion(se, cx) {
  const act = valorPeriodo(se, cx.per);
  const pas = valorPeriodo(se, cx.pasado);
  const ant = cx.anterior ? valorPeriodo(se, cx.anterior) : null;
  return { act, pas, ant, vPas: variacion(act, pas), vAnt: variacion(act, ant), historia: cx.historia.map((p) => valorPeriodo(se, p)) };
}
function subtituloComparacion(cx) {
  if (!cx.sexenio) return `${mayus(cx.per.largo)} contra ${cx.conAnterior && cx.anterior ? `${cx.anterior.corto} y ` : ""}${cx.etPasado}`;
  const otros = [cx.pasado?.corto, cx.anterior?.corto].filter(Boolean).join(" y ");
  return `${mayus(cx.per.largo)} contra ${cx.per.curso ? `los primeros ${cx.per.n} meses de ${otros}` : `el sexenio completo de ${otros}`} · promedio mensual`;
}
/** Cambios de sistema del SESNSP entre los periodos que se comparan (o dentro de ellos). */
function cambiosEntre(...pers) {
  const ps = pers.filter(Boolean);
  if (!ps.length) return [];
  const k0 = Math.min(...ps.map((p) => p.k0)), k1 = Math.max(...ps.map((p) => p.k1));
  return METODOLOGIAS.filter((mt) => mt.k > k0 && mt.k <= k1);
}
/** Avisos de la comparación por sexenio: datos que faltan y cambios de sistema. */
function avisosSexenio(cx, filas) {
  if (!cx.sexenio) return [];
  const todas = filas.flatMap((f) => [f, ...(f.hijos || [])]);
  const faltan = todas.some((f) => f.act != null && (f.pas == null || (cx.anterior && f.ant == null)));
  const cambios = cambiosEntre(cx.per, cx.pasado, cx.anterior);
  return [
    faltan ? h("p", { class: "aviso" }, "n.d.: no hay datos para todo ese sexenio. El SESNSP publica víctimas desde 2014, varios delitos desde 2015 o 2026 y lo municipal desde 2015; la serie empieza en 1997, así que Zedillo queda incompleto.") : null,
    cambios.length ? h("p", { class: "aviso" }, `La comparación cruza ${cambios.length > 1 ? "dos cambios" : "un cambio"} de sistema del SESNSP (${cambios.map((c) => c.largo).join(" y ")}): parte de la diferencia puede deberse a cómo se registran los delitos.`) : null,
  ].filter(Boolean);
}
/** "en septiembre 2026", o "en el sexenio de …, promedio mensual". */
const enPeriodo = (cx) => (cx.sexenio ? `el ${cx.per.largo}, promedio mensual` : cx.per.largo);
/** Texto de "Cómo leer" para la comparación por sexenio. */
const leerSexenio = (cx) => (cx.sexenio ? [
  `Por sexenio: promedio mensual de cada gobierno, porque no duran lo mismo. ${cx.per.curso
    ? `El de ${cx.per.corto} va en curso: se comparan sus ${cx.per.n} meses con los primeros ${cx.per.n} de los anteriores.`
    : "Se compara el sexenio completo con los anteriores completos."}`,
  cx.per.curso && cx.per.n % 12 ? `Como ${cx.per.n} meses no son años completos, las ventanas abarcan meses del año distintos y la estacionalidad puede mover un poco la comparación.` : null,
] : []);

/**
 * Tabla de variación o de ranking. Cada fila: {nombre (nodo), act, pas, ant,
 * vPas, vAnt, historia, irA, irATendencia, hijos?, rango?, ref?}.
 */
function tablaVariacion({ columna, cx, filas, ranking = false }) {
  const ant = cx.conAnterior;
  // Las barras se encogen hasta su mínimo antes que el nombre; debajo de eso la
  // vista acomoda la columna lateral abajo (.dos-col.ancha) o usa la tabla compacta.
  const barra = ranking ? "minmax(124px,190px)" : "minmax(116px,150px)";
  const cols = ranking
    ? ["36px", "minmax(140px,1fr)", "72px", ant ? "72px" : null, "76px", barra, ant ? barra : null]
    : ["24px", "minmax(140px,1fr)", "60px", ant ? "60px" : null, "66px", barra, ant ? barra : null, "96px"];
  const plantilla = cols.filter(Boolean).join(" ");
  // Por sexenio, las cifras van en orden cronológico (el de antes, el anterior, el elegido).
  const ordenar = (pas, an) => (cx.cronologico ? [an, pas] : [pas, an]);
  const enc = h("div", { class: "enc", style: { gridTemplateColumns: plantilla }, "aria-hidden": "true" },
    h("div", { class: "der" }, ranking ? "#" : ""), h("div", {}, columna),
    ordenar(h("div", { class: "der" }, mayus(cx.etPasado)), ant ? h("div", { class: "der" }, mayus(cx.anterior?.corto ?? "")) : null),
    h("div", { class: "der", style: { color: "var(--texto)", fontWeight: 500 } }, mayus(cx.per.corto)),
    h("div", { class: "cen" }, cx.etiquetas?.pas ?? "Contra año anterior"), ant ? h("div", { class: "cen" }, cx.etiquetas?.ant ?? "Contra periodo anterior") : null,
    ranking ? null : h("div", { class: "cen" }, "Tendencia"));
  const tabla = h("div", { class: "tabla", role: "table", "aria-label": columna });
  const renglon = (f, { hijo = false, alternar = null } = {}) => h("div", {
    class: `fila ${hijo ? "hijo" : ""} ${f.ref ? "ref" : ""}`, style: { gridTemplateColumns: plantilla }, hidden: hijo,
    role: f.ref ? "row" : "link", tabindex: f.ref ? null : 0, onclick: f.ref ? null : f.irA,
    onkeydown: f.ref ? null : (ev) => { if (ev.key === "Enter") f.irA(); },
  },
    ranking ? h("div", { class: "rk" }, f.ref ? "" : f.rango)
      : alternar ? h("button", { type: "button", class: "desplegar", "aria-label": "Ver componentes", "aria-expanded": "false", onclick: alternar }, ic("derecha", 16))
        : h("span"),
    h("div", { class: "nombre" }, f.nombre),
    ordenar(h("div", { class: "num col-web" }, fmt(f.pas)), ant ? h("div", { class: "num col-web" }, fmt(f.ant)) : null),
    h("div", { class: "num fuerte col-web" }, fmt(f.act)),
    celdaVar(f.vPas), ant ? celdaVar(f.vAnt) : null,
    ranking ? null : h("div", { class: "chispa col-web", title: "Ver líneas de tendencia",
      onclick: (ev) => { ev.stopPropagation(); f.irATendencia(); } }, chispa(f.historia)),
    h("div", { class: "var-movil" }, h("b", {}, fmt(f.act)),
      h("span", { class: `va ${claseVar(f.vPas)}` }, pctTexto(f.vPas, true)),
      ant ? h("span", { class: `vm ${claseVar(f.vAnt)}` }, pctTexto(f.vAnt, true)) : null));
  const cuerpo = filas.flatMap((f) => {
    if (!f.hijos?.length) return [renglon(f)];
    const hijos = f.hijos.map((x) => renglon(x, { hijo: true }));
    const alternar = (ev) => {
      ev.stopPropagation();
      const b = ev.currentTarget, ab = b.getAttribute("aria-expanded") !== "true";
      b.setAttribute("aria-expanded", String(ab));
      for (const r of hijos) r.hidden = !ab;
    };
    return [renglon(f, { alternar }), ...hijos];
  });
  tabla.append(enc, ...cuerpo);
  // En celular y tableta cabe una variación a la vez: un botón elige cuál.
  const elegir = ant ? segmento([
    h("button", { type: "button", class: "on", onclick: (ev) => { tabla.classList.remove("ver-mes"); marcar(ev); } }, `Contra ${cx.etPasado}`),
    h("button", { type: "button", onclick: (ev) => { tabla.classList.add("ver-mes"); marcar(ev); } }, `Contra ${cx.anterior?.corto ?? "anterior"}`),
  ], "solo-angosto") : null;
  function marcar(ev) { for (const b of ev.currentTarget.parentNode.children) b.classList.toggle("on", b === ev.currentTarget); }
  return [elegir, tabla];
}

function csvVariacion(cx, filas) {
  return filas.flatMap((f) => [f, ...(f.hijos || [])]).filter((f) => !f.ref).map((f) => ({
    ...f.columnas, unidad: unidad().name, indicador: indicador().name,
    [cx.etPasado]: redondeo(f.pas), ...(cx.conAnterior ? { [cx.anterior?.corto ?? "anterior"]: redondeo(f.ant) } : {}), [cx.per.corto]: redondeo(f.act),
    ...(cx.sexenio ? { medida: "promedio mensual" } : {}),
    [cx.csv?.pas ?? "var_anio_pasado"]: f.vPas == null ? null : +f.vPas.toFixed(2),
    ...(cx.conAnterior ? { [cx.csv?.ant ?? "var_periodo_anterior"]: f.vAnt == null ? null : +f.vAnt.toFixed(2) } : {}),
  }));
}
const grupoTendencia = (g) => (g.n <= 0 ? "month" : g.value);

// ── Gráfica de líneas con selector de periodo ───────────────────────────────
// Sexenios para los atajos del periodo (meses absolutos, inicio y fin).
// López Obrador duró 70 meses: la reforma de 2014 adelantó el cambio de gobierno a octubre.
const SEXENIOS = [
  { nombre: "Zedillo", clave: "zedillo", k0: abs("1994-12"), k1: abs("2000-11") },
  { nombre: "Fox", clave: "fox", k0: abs("2000-12"), k1: abs("2006-11") },
  { nombre: "Calderón", clave: "calderon", k0: abs("2006-12"), k1: abs("2012-11") },
  { nombre: "Peña Nieto", clave: "pena-nieto", k0: abs("2012-12"), k1: abs("2018-11") },
  { nombre: "López Obrador", clave: "lopez-obrador", k0: abs("2018-12"), k1: abs("2024-09") },
  { nombre: "Sheinbaum", clave: "sheinbaum", k0: abs("2024-10"), k1: Infinity },
];
// Cambios de metodología del SESNSP, marcados en las gráficas.
const METODOLOGIAS = [{ k: abs("2015-01"), largo: "2015 · SISDEL", corto: "SISDEL" }, { k: abs("2026-01"), largo: "2026 · RNID", corto: "RNID" }];

/**
 * Gráfica de líneas con atajos por sexenio y una barra con la serie completa
 * para elegir el tramo con dos manijas. El tramo se guarda en la URL.
 */
function graficaPeriodo(cont, lista, series) {
  const n = lista.length;
  if (!n) { cont.replaceChildren(h("p", { class: "aviso" }, "No hay datos para esta selección.")); return; }
  const movil = esMovil();
  const W = cont.clientWidth;
  const H = movil ? 260 : Math.max(320, Math.min(460, innerHeight - 380));
  const M = { l: 46, r: 14, t: 34, b: 30 };
  const minimo = Math.min(2, n - 1);
  const idxDesde = (k) => { const i = lista.findIndex((p) => p.k1 >= k); return i < 0 ? n - 1 : i; };
  const idxHasta = (k) => { let i = -1; lista.forEach((p, j) => { if (p.k0 <= k) i = j; }); return i < 0 ? 0 : i; };
  let i0 = q.desde ? idxDesde(abs(q.desde)) : 0;
  let i1 = q.hasta ? idxHasta(abs(q.hasta)) : n - 1;
  if (i1 - i0 < minimo) { i0 = 0; i1 = n - 1; }

  // Atajos: todo el periodo y cada sexenio con datos.
  const disponibles = SEXENIOS.filter((x) => x.k1 >= lista[0].k0 && x.k0 <= lista[n - 1].k1);
  const tramoDe = (x) => [idxDesde(Math.max(x.k0, lista[0].k0)), idxHasta(Math.min(x.k1, lista[n - 1].k1))];
  const botones = [
    h("button", { type: "button", "data-tramo": "todo", onclick: () => fijar(0, n - 1) }, "Todo"),
    ...disponibles.map((x) => h("button", { type: "button", "data-tramo": x.nombre, onclick: () => fijar(...tramoDe(x)) }, x.nombre)),
    h("button", { type: "button", "data-tramo": "personalizado", disabled: true, title: "Arrastra las manijas de la barra para elegir otro tramo" }, "Personalizado"),
  ];
  const atajos = segmento(botones, "envolver");
  atajos.setAttribute("aria-label", "Periodo de la gráfica");
  // Líneas verticales al inicio de cada sexenio; se prenden aquí y quedan en la URL.
  const lineas = h("button", { type: "button", class: "btn conmutar", onclick: () => {
    q.sexenios = q.sexenios ? "" : "1";
    marcarLineas();
    history.replaceState(null, "", urlActual());
    dibujar();
  } });
  const marcarLineas = () => {
    lineas.classList.toggle("on", !!q.sexenios);
    lineas.setAttribute("aria-pressed", String(!!q.sexenios));
    lineas.replaceChildren(h("span", { class: "marca-op" }, q.sexenios ? ic("palomita", 14) : null), "Líneas de sexenio");
  };
  marcarLineas();

  const svg = s("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Gráfica de líneas" });
  const plot = s("g", { class: "eje" });
  svg.append(plot);

  // Barra de periodo: la primera serie completa, las franjas de los sexenios y la ventana.
  const HB = 86, TB = 22, BB = HB - 20;
  const Xb = (i) => M.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - M.l - M.r));
  const barra = s("svg", { width: W, height: HB, viewBox: `0 0 ${W} ${HB}`, role: "img", "aria-label": "Barra para elegir el periodo" });
  for (const [j, x] of disponibles.entries()) {
    const [a, b] = tramoDe(x);
    barra.append(s("rect", { x: Xb(a), y: TB, width: Math.max(0, Xb(b) - Xb(a)), height: BB - TB, fill: j % 2 ? "var(--panel)" : "transparent" }));
    if (Xb(b) - Xb(a) > (movil ? 46 : 60)) barra.append(s("text", { x: (Xb(a) + Xb(b)) / 2, y: TB - 8, "text-anchor": "middle", "font-size": 11 }, movil ? x.nombre.split(" ")[0] : x.nombre));
  }
  barra.append(s("rect", { x: M.l, y: TB, width: W - M.l - M.r, height: BB - TB, fill: "none", stroke: "var(--linea)" }));
  const base = series[0].pts, vb = base.filter((v) => v != null);
  if (vb.length > 1) {
    const mn = Math.min(...vb), mx = Math.max(...vb);
    let d = "", pen = false;
    base.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${Xb(i).toFixed(1)},${(BB - 4 - ((v - mn) / (mx - mn || 1)) * (BB - TB - 8)).toFixed(1)}`; pen = true; });
    barra.append(s("path", { d, fill: "none", stroke: "var(--texto2)", "stroke-width": 1 }));
  }
  const cadaB = movil ? 10 : 4;
  lista.forEach((p, i) => { if (mes(p.k0) === 0 && anio(p.k0) % cadaB === 0) barra.append(s("text", { x: Xb(i), y: HB - 5, "text-anchor": "middle", "font-size": 11 }, String(anio(p.k0)))); });
  const sombraA = s("rect", { y: TB, height: BB - TB, fill: "var(--fondo)", "fill-opacity": 0.6, "pointer-events": "none" });
  const sombraB = s("rect", { y: TB, height: BB - TB, fill: "var(--fondo)", "fill-opacity": 0.6, "pointer-events": "none" });
  const ventana = s("rect", { class: "ventana", y: TB, height: BB - TB, fill: "var(--acento)", "fill-opacity": 0.12, stroke: "var(--acento)", "stroke-width": 1.5 });
  const asa = () => {
    const g = s("g", { class: "asa", tabindex: 0, role: "slider" });
    g.append(s("rect", { x: -7, y: (TB + BB) / 2 - 16, width: 14, height: 32, rx: 3, fill: "var(--fondo)", stroke: "var(--acento-texto)", "stroke-width": 1.5 }),
      s("line", { x1: -2, x2: -2, y1: (TB + BB) / 2 - 6, y2: (TB + BB) / 2 + 6, stroke: "var(--acento-texto)" }),
      s("line", { x1: 2, x2: 2, y1: (TB + BB) / 2 - 6, y2: (TB + BB) / 2 + 6, stroke: "var(--acento-texto)" }),
      s("rect", { x: -16, y: TB - 6, width: 32, height: BB - TB + 12, fill: "transparent" }));
    return g;
  };
  const asaA = asa(), asaB = asa();
  asaA.setAttribute("aria-label", "Inicio del periodo"); asaB.setAttribute("aria-label", "Fin del periodo");
  barra.append(sombraA, sombraB, ventana, asaA, asaB);
  const fechaA = h("span"), fechaB = h("span");
  const barraCont = h("div", { class: "barra-periodo" }, h("div", { class: "fechas" }, fechaA, fechaB), barra);

  function pintarBarra() {
    sombraA.setAttribute("x", M.l); sombraA.setAttribute("width", Math.max(0, Xb(i0) - M.l));
    sombraB.setAttribute("x", Xb(i1)); sombraB.setAttribute("width", Math.max(0, W - M.r - Xb(i1)));
    ventana.setAttribute("x", Xb(i0)); ventana.setAttribute("width", Math.max(1, Xb(i1) - Xb(i0)));
    asaA.setAttribute("transform", `translate(${Xb(i0)},0)`); asaB.setAttribute("transform", `translate(${Xb(i1)},0)`);
    asaA.setAttribute("aria-valuetext", lista[i0].largo); asaB.setAttribute("aria-valuetext", lista[i1].largo);
    fechaA.textContent = lista[i0].corto; fechaB.textContent = lista[i1].corto;
    const xa = Xb(i0), xb = Xb(i1);
    fechaA.style.left = `${Math.max(0, xa - 40)}px`;
    fechaB.style.left = ""; fechaB.style.right = `${Math.max(0, W - xb - 40)}px`;
    if (xb - xa < 120) { fechaA.style.left = `${Math.max(0, xa - 90)}px`; fechaB.style.right = `${Math.max(0, W - xb - 90)}px`; }
    const activo = i0 === 0 && i1 === n - 1 ? "todo" : disponibles.find((x) => { const [a, b] = tramoDe(x); return a === i0 && b === i1; })?.nombre ?? "personalizado";
    for (const b of botones) b.classList.toggle("on", b.dataset.tramo === activo);
  }

  function dibujar() {
    plot.replaceChildren();
    const X = (i) => M.l + (i1 === i0 ? 0 : ((i - i0) / (i1 - i0)) * (W - M.l - M.r));
    // Con sexenios, sus nombres van arriba en una o dos filas, para que no se encimen.
    const sexenios = q.sexenios ? acomodarSexenios(X) : null;
    M.t = sexenios ? 34 + 18 * sexenios.filas : 34;
    let min = Infinity, max = -Infinity;
    for (const se of series) for (let i = i0; i <= i1; i++) { const v = se.pts[i]; if (v != null) { min = Math.min(min, v); max = Math.max(max, v); } }
    if (!isFinite(min)) { min = 0; max = 1; }
    const esc = escalaY(min, max, movil ? 4 : 6);
    const Y = (v) => H - M.b - ((v - esc.y0) / (esc.y1 - esc.y0)) * (H - M.t - M.b);
    for (const v of esc.ticks) {
      plot.append(s("line", { x1: M.l, x2: W - M.r, y1: Y(v), y2: Y(v), stroke: "var(--rejilla)" }),
        s("text", { x: M.l - 8, y: Y(v) + 4, "text-anchor": "end" }, fmtEje(v, esc.paso)));
    }
    plot.append(s("line", { x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b, stroke: "var(--eje)" }));
    // Marcas del eje X: años, más espaciados mientras más largo el tramo.
    const anios = anio(lista[i1].k1) - anio(lista[i0].k0) + 1;
    const cada = [1, 2, 5, 10].find((c) => anios / c <= (W - M.l) / (movil ? 70 : 64)) || 10;
    for (let i = i0; i <= i1; i++) {
      const p = lista[i];
      if (mes(p.k0) !== 0 || anio(p.k0) % cada !== 0) continue;
      plot.append(s("line", { x1: X(i), x2: X(i), y1: H - M.b, y2: H - M.b + 5, stroke: "var(--eje)" }),
        s("text", { x: X(i), y: H - 8, "text-anchor": "middle" }, String(anio(p.k0))));
    }
    if (sexenios) {
      for (const xi of sexenios.lineas) plot.append(s("line", { x1: xi, x2: xi, y1: 8, y2: H - M.b, stroke: "var(--fuerte)", "stroke-opacity": 0.45 }));
      for (const e of sexenios.etiquetas) {
        plot.append(s("text", { x: e.x, y: M.t - 30 - 18 * e.fila, "text-anchor": e.anchor, "font-weight": 500, fill: "var(--texto)" }, e.texto));
      }
    }
    // Cambios de metodología del SESNSP dentro del tramo.
    for (const mt of METODOLOGIAS) {
      const i = lista.findIndex((p) => p.k0 <= mt.k && mt.k <= p.k1);
      if (i <= i0 || i > i1) continue;
      const der = X(i) > W * 0.7;
      plot.append(s("line", { x1: X(i), x2: X(i), y1: M.t - 6, y2: H - M.b, stroke: "var(--texto2)", "stroke-dasharray": "3 4" }),
        s("text", { x: X(i) + (der ? -6 : 6), y: M.t - 12, "text-anchor": der ? "end" : "start" }, movil ? mt.corto : mt.largo));
    }
    series.forEach((se) => {
      let dd = "", pen = false;
      for (let i = i0; i <= i1; i++) {
        const v = se.pts[i];
        if (v == null) { pen = false; continue; }
        dd += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
        pen = true;
      }
      plot.append(s("path", { d: dd, fill: "none", stroke: se.color, "stroke-width": 2, "stroke-linejoin": "round" }));
    });
    const guia = s("line", { y1: M.t, y2: H - M.b, stroke: "var(--texto)", visibility: "hidden" });
    const puntos = series.map((se) => s("circle", { r: 4, fill: se.color, stroke: "var(--fondo)", "stroke-width": 2, visibility: "hidden" }));
    const zona = s("rect", { x: M.l, y: M.t, width: Math.max(0, W - M.l - M.r), height: H - M.t - M.b, fill: "transparent" });
    plot.append(guia, ...puntos, zona);
    const mover = (ev) => {
      const r = svg.getBoundingClientRect();
      const x = (ev.clientX - r.left) * (W / r.width);
      const i = Math.max(i0, Math.min(i1, Math.round(i0 + ((x - M.l) / (W - M.l - M.r)) * (i1 - i0))));
      guia.setAttribute("x1", X(i)); guia.setAttribute("x2", X(i)); guia.setAttribute("visibility", "visible");
      const filas = [h("b", {}, mayus(lista[i].largo))];
      series.forEach((se, j) => {
        const v = se.pts[i];
        if (v == null) puntos[j].setAttribute("visibility", "hidden");
        else { puntos[j].setAttribute("cx", X(i)); puntos[j].setAttribute("cy", Y(v)); puntos[j].setAttribute("visibility", "visible"); }
        filas.push(h("div", {}, h("span", { class: "punto", style: { background: se.color } }), `${se.nombre}: `, h("b", {}, fmt(v))));
      });
      tip.mostrar(ev, filas);
    };
    zona.addEventListener("pointermove", mover);
    zona.addEventListener("pointerdown", mover);
    zona.addEventListener("pointerleave", () => { tip.ocultar(); guia.setAttribute("visibility", "hidden"); puntos.forEach((p) => p.setAttribute("visibility", "hidden")); });
  }

  /**
   * Líneas al inicio de cada sexenio dentro del tramo y sus nombres; el que ya
   * iba en curso al empezar el tramo se nombra en la orilla izquierda. Cada
   * nombre va en la primera de dos filas donde no choque; si no cabe, se omite.
   */
  function acomodarSexenios(X) {
    const nombre = (x) => (movil ? x.nombre.split(" ")[0] : x.nombre);
    const ancho = (txt) => txt.length * 6.8;
    const inicios = SEXENIOS.map((x) => ({ x, i: lista.findIndex((p) => p.k0 <= x.k0 && x.k0 <= p.k1) })).filter((o) => o.i > i0 && o.i <= i1);
    const primero = SEXENIOS.find((x) => x.k0 <= lista[i0].k0 && lista[i0].k0 <= x.k1);
    const pedidas = [
      ...(primero ? [{ texto: nombre(primero), x: X(i0) + 2, anchor: "start" }] : []),
      ...inicios.map(({ x, i }) => (X(i) + 5 + ancho(nombre(x)) > W - M.r
        ? { texto: nombre(x), x: X(i) - 5, anchor: "end" } : { texto: nombre(x), x: X(i) + 5, anchor: "start" })),
    ];
    const ocupado = [[], []];
    const etiquetas = [];
    // Las más recientes primero: si algo no cabe, que sea lo más antiguo.
    for (const e of pedidas.reverse()) {
      const a = e.anchor === "end" ? e.x - ancho(e.texto) : e.x, b = a + ancho(e.texto);
      const fila = ocupado.findIndex((f) => f.every(([fa, fb]) => b + 8 < fa || a > fb + 8));
      if (fila < 0) continue;
      ocupado[fila].push([a, b]);
      etiquetas.push({ ...e, fila });
    }
    return { lineas: inicios.map(({ i }) => X(i)), etiquetas, filas: 1 + Math.max(0, ...etiquetas.map((e) => e.fila)) };
  }

  function guardar() {
    const todo = i0 === 0 && i1 === n - 1;
    q.desde = todo ? "" : ym(lista[i0].k0);
    q.hasta = todo ? "" : ym(lista[i1].k1);
    history.replaceState(null, "", urlActual());
  }
  function fijar(a, b) { i0 = a; i1 = Math.max(b, Math.min(n - 1, a + minimo)); pintarBarra(); dibujar(); guardar(); }

  // Arrastre de las manijas y de la ventana.
  const indice = (ev) => {
    const r = barra.getBoundingClientRect();
    const x = (ev.clientX - r.left) * (W / r.width);
    return Math.max(0, Math.min(n - 1, Math.round(((x - M.l) / (W - M.l - M.r)) * (n - 1))));
  };
  let arrastre = null;
  const empezar = (tipo) => (ev) => { ev.preventDefault(); ev.stopPropagation(); arrastre = { tipo, i: indice(ev), a: i0, b: i1 }; barra.setPointerCapture(ev.pointerId); };
  asaA.addEventListener("pointerdown", empezar("a"));
  asaB.addEventListener("pointerdown", empezar("b"));
  ventana.addEventListener("pointerdown", empezar("mover"));
  barra.addEventListener("pointermove", (ev) => {
    if (!arrastre) return;
    const i = indice(ev);
    if (arrastre.tipo === "a") i0 = Math.min(i, i1 - minimo);
    else if (arrastre.tipo === "b") i1 = Math.max(i, i0 + minimo);
    else { const dl = Math.max(-arrastre.a, Math.min(n - 1 - arrastre.b, i - arrastre.i)); i0 = arrastre.a + dl; i1 = arrastre.b + dl; }
    pintarBarra(); dibujar();
  });
  barra.addEventListener("pointerup", () => { if (arrastre) guardar(); arrastre = null; });
  // Teclado: flechas mueven cada manija un periodo.
  for (const [g, cual] of [[asaA, "a"], [asaB, "b"]]) {
    g.addEventListener("keydown", (ev) => {
      const d = ev.key === "ArrowLeft" ? -1 : ev.key === "ArrowRight" ? 1 : 0;
      if (!d) return;
      ev.preventDefault();
      if (cual === "a") i0 = Math.max(0, Math.min(i1 - minimo, i0 + d)); else i1 = Math.min(n - 1, Math.max(i0 + minimo, i1 + d));
      pintarBarra(); dibujar(); guardar();
    });
  }

  pintarBarra();
  dibujar();
  cont.replaceChildren(h("div", { class: "periodo" }, h("div", { class: "periodo-cab" }, atajos, lineas), h("div", { class: "grafica" }, svg), barraCont));
}

/** Botones de las series elegidas (con ×) y "+ Agregar" con buscador. */
function chipsSeleccion({ series, sel, items, max = 10, etiquetaAgregar, alCambiar }) {
  const quitar = (clave) => alCambiar(sel.filter((x) => x !== clave));
  const chips = series.map((se, i) => h("span", { class: "chip" },
    h("span", {}, h("i", { style: { background: se.color } }), " ", se.nombre),
    sel.length > 1 ? h("button", { type: "button", class: "x", "aria-label": `Quitar ${se.nombre}`, onclick: () => quitar(sel[i]) }, "×") : null));
  const agregar = h("button", { type: "button", class: "btn", "aria-haspopup": "listbox", "aria-expanded": "false", disabled: sel.length >= max,
    title: sel.length >= max ? `Máximo ${max}` : null,
    onclick: () => abrirLista({ ancla: agregar, titulo: etiquetaAgregar, multiple: true, valor: sel, buscar: items.length > 12,
      opciones: items.map((x) => ({ value: x.clave, name: x.nombre, nivel: x.nivel })),
      onElegir: (v) => alCambiar(sel.includes(v) ? (sel.length > 1 ? sel.filter((x) => x !== v) : sel) : [...sel, v].slice(0, max)) }) },
    `+ ${etiquetaAgregar}`);
  return h("div", { class: "chips" }, chips, h("span", { class: "agregar" }, agregar));
}
function descargarSeries(nombre, lista, series, extra = {}) {
  const filas = [];
  for (const se of series) for (let i = 0; i < lista.length; i++) {
    filas.push({ serie: se.nombre, ...extra, unidad: unidad().name, indicador: indicador().name, periodo: lista[i].largo, valor: redondeo(se.pts[i]) });
  }
  bajarCSV(nombre, filas);
}
const leerGrafica = () => leer("Cómo leer esta gráfica",
  "Cada línea es una serie; puedes comparar varias a la vez y quitarlas con la ×.",
  "Las líneas punteadas marcan cambios de metodología del SESNSP (2015 y 2026): pueden mover la serie sin que cambie el fenómeno.",
  "Los atajos fijan el periodo de cada sexenio; con las manijas de la barra inferior eliges cualquier otro tramo.",
  "Pasa el cursor sobre la gráfica para ver el valor de cada periodo.");

// ═══════════════════════════════════════════════════════════════════════════
// Vistas
// ═══════════════════════════════════════════════════════════════════════════

// ── Inicio ──────────────────────────────────────────────────────────────────
// ── Inicio ──────────────────────────────────────────────────────────────────
// La bienvenida está en index.html (la barra de arriba se abre). Aquí va todo
// lo que se puede hacer: preguntar con una frase, buscar, ver lo más reciente,
// elegir una herramienta o un estado. Nada de mapa de entrada.
const DESTACADOS = [1100, 1120, 3000, 2000, 4001, 6000];
const fechaLarga = (k) => `${MESES_LARGO[mes(k)]} de ${anio(k)}`;
const nombreEnFrase = (d) => d.nombre.replace(" (incl. feminicidio)", "").toLowerCase();

/** Carpetas del último mes en todo el país, su cambio contra el mismo mes del año anterior y los últimos 24 meses. */
async function cifrasNacionales() {
  const nac = await cargarEntidad(0);
  return principales().filter((d) => d.codigo !== 0 && nac.delitos[d.codigo]?.ci).map((d) => {
    const se = serie(nac.delitos[d.codigo].ci, null, "c");
    const act = suma(se, CORTE, CORTE);
    const historia = [];
    for (let k = CORTE - 23; k <= CORTE; k++) historia.push(suma(se, k, k));
    return { d, act, v: variacion(act, suma(se, CORTE - 12, CORTE - 12)), historia };
  });
}

/** Línea de 24 meses que llena su caja; el punto gris es el mismo mes del año anterior. */
function chispaAncha(vals, W = 240, H = 44) {
  const v = vals.filter((x) => x != null);
  if (v.length < 2) return s("svg", { class: "chispa-ancha" });
  const min = Math.min(...v), max = Math.max(...v);
  const px = (i) => 3 + (i / (vals.length - 1)) * (W - 6), py = (x) => H - 4 - ((x - min) / (max - min || 1)) * (H - 8);
  let dd = "", pen = false;
  vals.forEach((x, i) => { if (x == null) { pen = false; return; } dd += `${pen ? "L" : "M"}${px(i).toFixed(1)},${py(x).toFixed(1)}`; pen = true; });
  const n = vals.length - 1, ref = n - 12;
  return s("svg", { class: "chispa-ancha", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", role: "img", "aria-label": "Últimos 24 meses" },
    s("path", { d: dd, fill: "none", stroke: "var(--texto2)", "stroke-width": 1.4, "vector-effect": "non-scaling-stroke", "stroke-linejoin": "round" }),
    vals[ref] != null ? s("circle", { cx: px(ref), cy: py(vals[ref]), r: 2.5, fill: "var(--eje)" }) : null,
    vals[n] != null ? s("circle", { cx: px(n), cy: py(vals[n]), r: 3.2, fill: "var(--fuerte)" }) : null);
}

// Buscador: delitos y estados primero; luego municipios, los más grandes antes
// (datos/municipios.json trae sus carpetas del último año como peso).
let indiceBusqueda = null;
function cargarIndiceBusqueda() {
  if (!indiceBusqueda) {
    const fijos = [
      ...principales().map((d) => ({ tipo: "Delito", nombre: d.nombre, href: urlDe("tendencia", { crime: d.codigo }), peso: 1e12 })),
      ...META.entidades.slice(1).map((e) => ({ tipo: "Estado", nombre: e.nombre, href: urlDe("variacion", { state: e.codigo }), peso: 1e12 })),
    ];
    indiceBusqueda = cargar("datos/municipios.json").then((x) => fijos.concat(x.municipios.map(([m, nombre, peso]) => {
      const e = entidad(Math.floor(m / 1000));
      return { tipo: `Municipio, ${e.nombre}`, nombre, peso, href: urlDe(`tendencia/${e.slug}`, { states: `0,${m}` }) };
    }))).catch(() => fijos);
  }
  return indiceBusqueda;
}
function buscador() {
  const res = h("div", { class: "buscar-res", role: "listbox", hidden: true });
  const inp = h("input", { type: "search", autocomplete: "off", "aria-label": "Buscar un delito, un estado o un municipio",
    placeholder: esMovil() ? "Delito, estado o municipio" : "Busca un delito, un estado o un municipio" });
  let hallados = [], activo = 0;
  const marcar = () => [...res.children].forEach((a, i) => a.classList.toggle("activo", i === activo));
  inp.addEventListener("input", async () => {
    const t = sinAcentos(inp.value.trim());
    if (t.length < 2) { res.hidden = true; hallados = []; return; }
    const todos = await cargarIndiceBusqueda();
    if (sinAcentos(inp.value.trim()) !== t) return; // ya escribió otra cosa
    const empieza = (x) => (sinAcentos(x.nombre).startsWith(t) ? 1 : 0);
    hallados = todos.filter((x) => sinAcentos(x.nombre).includes(t)).sort((a, b) => empieza(b) - empieza(a) || b.peso - a.peso).slice(0, 8);
    activo = 0;
    res.replaceChildren(...(hallados.length
      ? hallados.map((x, i) => h("a", { href: x.href, role: "option", onmouseenter: () => { activo = i; marcar(); } }, h("span", {}, x.nombre), h("small", {}, x.tipo)))
      : [h("p", { class: "vacio" }, "Sin resultados")]));
    marcar();
    res.hidden = false;
  });
  inp.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { res.hidden = true; return; }
    if (res.hidden || !hallados.length) return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      activo = (activo + (ev.key === "ArrowDown" ? 1 : hallados.length - 1)) % hallados.length;
      marcar();
    } else if (ev.key === "Enter") { ev.preventDefault(); location.href = hallados[activo].href; }
  });
  inp.addEventListener("focus", () => { if (hallados.length) res.hidden = false; });
  // Con retraso: un clic en un resultado llega después de que el campo pierde el foco.
  inp.addEventListener("blur", () => setTimeout(() => { res.hidden = true; }, 200));
  return h("div", { class: "buscar" }, h("label", { class: "buscar-caja" }, ic("lupa", 20), inp), res);
}

// "Quiero ver [la tendencia] de [homicidio doloso] en [todo el país]".
const PREGUNTAS = [
  { value: "tendencia", name: "la tendencia" },
  { value: "mapa", name: "el mapa" },
  { value: "ranking", name: "el ranking" },
  { value: "variacion", name: "qué subió y qué bajó" },
];
/** A dónde lleva la frase. Con un estado, el mapa y el ranking van por municipio. */
function urlPregunta(que, crime, e) {
  const est = Number(e) && entidad(e).municipios ? entidad(e) : null;
  if (que === "tendencia") return urlDe("tendencia", { crime, state: Number(e) ? `0,${e}` : "0" });
  if (que === "mapa") return urlDe(est ? `mapa/${est.slug}` : "mapa", { crime, group: "accumulated" });
  if (que === "ranking") return est ? urlDe(`ranking/${est.slug}`, { crime }) : urlDe(`variacion/${crime}`, { crime });
  return urlDe("variacion", { state: e });
}
function frasePregunta() {
  const st = { que: "tendencia", crime: "1100", state: "0" };
  const ver = h("a", { class: "btn btn-fuerte" }, "Ver", ic("flecha", 18));
  const menu = (clave, titulo, opciones) => {
    const b = h("button", { type: "button", class: "frase-sel", "aria-label": titulo });
    const mostrar = () => {
      b.replaceChildren(opciones.find((o) => o.value === st[clave]).name, ic("abajo", 18));
      ver.href = urlPregunta(st.que, st.crime, st.state);
    };
    b.addEventListener("click", () => abrirLista({ ancla: b, titulo, opciones, valor: st[clave], buscar: opciones.length > 8,
      onElegir: (v) => { st[clave] = String(v); mostrar(); } }));
    mostrar();
    return b;
  };
  return h("div", { class: "frase" },
    h("span", {}, "Quiero ver"), menu("que", "Qué quieres ver", PREGUNTAS),
    h("span", {}, "de"), menu("crime", "Delito", principales().filter((d) => d.codigo).map((d) => ({ value: String(d.codigo), name: nombreEnFrase(d) }))),
    h("span", {}, "en"), menu("state", "Lugar", [{ value: "0", name: "todo el país" }, ...META.entidades.slice(1).map((e) => ({ value: String(e.codigo), name: e.nombre }))]),
    ver);
}
function consultasFrecuentes() {
  return [
    ["Homicidio doloso, año por año", urlDe("tendencia", { crime: 1100, group: "anual" })],
    [`Feminicidio por estado en ${anio(CORTE)}`, urlDe("mapa", { crime: 1120, group: "accumulated" })],
    [`Qué delitos subieron en ${MESES_LARGO[mes(CORTE)]}`, urlDe("variacion", {})],
    ["Municipios de Guanajuato por homicidio", urlDe("ranking/guanajuato", { crime: 1100 })],
    ["Extorsión: estados con mayor tasa", urlDe("variacion/3000", { crime: 3000 })],
    ["Este sexenio contra los anteriores", urlDe("variacion", { group: "sexenio" })],
  ];
}

/** En celular las consultas frecuentes van plegadas y se abren con un toque; en computadora, abiertas. */
function consultasPlegables() {
  const lista = consultasFrecuentes();
  return h("details", { class: "frecuentes", open: !esMovil() },
    h("summary", { onclick: (ev) => { if (!esMovil()) ev.preventDefault(); } },
      h("span", { class: "etq" }, "Consultas frecuentes"), h("span", { class: "frec-n" }, `(${lista.length})`), ic("abajo", 18)),
    h("div", {}, lista.map(([t, href]) => h("a", { href }, t))));
}

function herramientas() {
  const csv = META.descargas?.[0];
  return [
    { ic: "tendencia", titulo: "Tendencias", href: urlDe("tendencia", {}),
      texto: "Un delito mes a mes desde 1997. Compara hasta 10 estados o municipios y elige el periodo por sexenio.",
      ej: ["Homicidio doloso en Guanajuato y el país", urlDe("tendencia", { crime: 1100, state: "0,11" })] },
    { ic: "mapa", titulo: "Mapa", href: urlDe("mapa", {}),
      texto: "Las 32 entidades o los municipios de un estado, coloreados por su tasa por cada 100 mil habitantes.",
      ej: [`Extorsión en ${anio(CORTE)}, por estado`, urlDe("mapa", { crime: 3000, group: "accumulated" })] },
    { ic: "variacion", titulo: "Variación", href: urlDe("variacion", {}),
      texto: "Qué subió y qué bajó contra el periodo anterior y contra el mismo periodo del año pasado.",
      ej: [`${mayus(MESES_LARGO[mes(CORTE)])} en Jalisco`, urlDe("variacion", { state: 14 })] },
    { ic: "ranking", titulo: "Rankings", href: urlDe("variacion/1100", { crime: 1100 }),
      texto: "Ordena estados o municipios de mayor a menor, por tasa o por número de casos.",
      ej: ["Municipios de Chihuahua por homicidio", urlDe("ranking/chihuahua", { crime: 1100 })] },
    { ic: "comparar", titulo: "Comparar delitos", href: urlDe("comparar", {}),
      texto: "Hasta 5 delitos en la misma gráfica, con comparaciones sugeridas.",
      ej: ["Feminicidio y homicidio doloso de mujeres", urlDe("comparar", { crimes: "1120,1130", unit: "victims" })] },
    { ic: "descargar", titulo: "Descargar datos", href: urlDe("descargar", {}),
      texto: "Las cifras en CSV o JSON con los filtros que elijas; los mapas en GeoJSON.",
      ej: [`Todo el histórico estatal${csv ? ` (${Math.round(csv.bytes / 1e6)} MB)` : ""}`, urlDe("descargar", {})] },
  ];
}

/** Miniatura de cada herramienta, dibujada con datos reales (homicidio doloso y feminicidio). */
function miniaturas(cifras, dHom, dFem) {
  const W = 168, H = 76, yc = anio(CORTE);
  const anual = (dat) => { const se = serie(dat.ci, 0, "c"), out = []; for (let y = 1997; y < yc; y++) out.push(suma(se, y * 12, y * 12 + 11)); return out; };
  const linea = (vals, color) => {
    const max = Math.max(...vals.filter((x) => x != null));
    let dd = "";
    vals.forEach((x, i) => { if (x != null) dd += `${dd ? "L" : "M"}${(6 + (i / (vals.length - 1)) * (W - 12)).toFixed(1)},${(H - 8 - (x / max) * (H - 20)).toFixed(1)}`; });
    return s("path", { d: dd, fill: "none", stroke: color, "stroke-width": 1.6, "stroke-linejoin": "round" });
  };
  const caja = (...hijos) => s("svg", { viewBox: `0 0 ${W} ${H}`, class: "mini", "aria-hidden": "true" }, s("rect", { width: W, height: H, fill: "var(--panel)" }), ...hijos);
  const tasas = META.entidades.map((x) => suma(serie(dHom.ci, x.codigo, "t"), yc * 12, CORTE));
  const cls = clasificar(tasas.slice(1).filter((v) => v != null));
  const geo = geoEstados();
  const top = tasas.map((v, e) => ({ v, e })).slice(1).filter((x) => x.v != null).sort((a, b) => b.v - a.v).slice(0, 6);
  const vars = cifras.slice().sort((a, b) => b.act - a.act).slice(0, 8);
  const hom = anual(dHom);
  return {
    tendencia: caja(linea(hom, "var(--fuerte)")),
    mapa: s("svg", { viewBox: `0 0 ${geo.ancho} ${geo.alto}`, class: "mini mini-mapa", "aria-hidden": "true" },
      Object.entries(geo.trazos).map(([e, d]) => s("path", { d, fill: cls.color(tasas[e]), stroke: "var(--fondo)", "stroke-width": 0.6, "vector-effect": "non-scaling-stroke" }))),
    variacion: caja(s("line", { x1: W / 2, x2: W / 2, y1: 6, y2: H - 6, stroke: "var(--eje)" }),
      vars.map((x, i) => { const v = x.v ?? 0, w = Math.min(Math.abs(v) / 40, 1) * (W / 2 - 14);
        return s("rect", { x: v < 0 ? W / 2 - w : W / 2, y: 7 + i * 8, width: Math.max(w, 1), height: 5, fill: v < 0 ? "var(--barra-baja)" : "var(--barra-sube)" }); })),
    ranking: caja(top.map((x, i) => s("rect", { x: 10, y: 8 + i * 10.5, width: (x.v / top[0].v) * (W - 28), height: 6, fill: i ? "var(--barra-rank)" : "var(--barra-rank-fuerte)" }))),
    comparar: caja(linea(hom, "var(--fuerte)"), linea(anual(dFem), "var(--sube)")),
    descargar: caja(Array.from({ length: 6 }, (_, f) => [30, 42, 34].map((w, c) => s("rect", { x: 14 + [0, 36, 84][c], y: 9 + f * 10, width: w - 4, height: 6,
      fill: f === 0 ? "var(--fuerte)" : "var(--barra-rank)" }))),
      s("path", { d: `M${W - 24} ${H - 40}v18m-7-7l7 7 7-7M${W - 31} ${H - 14}h14`, stroke: "var(--acento-texto)", "stroke-width": 2, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" })),
  };
}

async function vistaInicio(raiz) {
  const [cifras, dHom, dFem] = await Promise.all([cifrasNacionales(), cargarDelito(1100), cargarDelito(1120)]);
  const dest = DESTACADOS.map((c) => cifras.find((x) => x.d.codigo === c)).filter(Boolean);
  const mini = miniaturas(cifras, dHom, dFem);
  // Si entre este mes y el del año anterior el SESNSP cambió de sistema, se avisa.
  const cambio = (META.periodos || []).find((p) => abs(p.desde) > CORTE - 12 && abs(p.desde) <= CORTE);
  raiz.append(h("div", { class: "contenido inicio" },
    h("section", { class: "pregunta" },
      h("h1", {}, "¿Qué quieres saber?"),
      frasePregunta(),
      h("div", { class: "buscar-fila" }, h("span", {}, "o busca directo"), buscador()),
      consultasPlegables()),
    h("section", { class: "seccion" },
      h("div", { class: "etq-fila" }, h("h2", { class: "etq" }, `Lo más reciente · ${fechaLarga(CORTE)}, en todo el país`),
        h("a", { class: "texto-enlace", href: urlDe("variacion", {}) }, "Los 20 delitos en la tabla de variación →")),
      h("div", { class: "cifras" }, dest.map((x) => h("a", { class: "cifra", href: urlDe("tendencia", { crime: x.d.codigo }) },
        h("div", { class: "cifra-cab" }, iconoDelito(x.d.codigo, true), h("span", {}, x.d.nombre)),
        h("div", { class: "cifra-fila" }, h("b", {}, NF0.format(x.act)), h("span", { class: `pct ${claseVar(x.v)}` }, pctTexto(x.v))),
        h("p", { class: "mut" }, x.v == null ? "carpetas" : `carpetas · ${x.v < 0 ? "menos" : "más"} que en ${mesCorto(CORTE - 12)}`),
        chispaAncha(x.historia)))),
      h("p", { class: "nota" }, `Carpetas de investigación en ${fechaLarga(CORTE)} en todo el país. La línea muestra los últimos 24 meses; el punto gris es ${mesCorto(CORTE - 12)}.`,
        cambio ? ` Desde ${fechaLarga(abs(cambio.desde))} el SESNSP reporta con un sistema nuevo (${cambio.nombre}), así que la comparación con ${anio(CORTE) - 1} cruza ese cambio.` : "")),
    h("section", { class: "seccion" },
      h("div", { class: "etq-fila" }, h("h2", { class: "etq" }, "Herramientas")),
      h("div", { class: "vitrina" }, herramientas().map((t) => h("div", { class: "vit" },
        h("a", { href: t.href, tabindex: "-1", "aria-hidden": "true" }, mini[t.ic]),
        h("div", {}, h("h3", {}, h("a", { href: t.href }, t.titulo)), h("p", {}, t.texto),
          h("a", { class: "texto-enlace", href: t.ej[1] }, t.ej[0], " →"))))),
      h("div", { class: "herr-extra" },
        h("button", { type: "button", class: "btn", onclick: modalInsertar }, ic("insertar", 18), "Insertar una gráfica en tu nota"),
        h("a", { class: "btn", href: `${RAIZ}nota-metodologica/` }, ic("libro", 18), "Nota metodológica"),
        h("a", { class: "btn", href: "https://onc.org.mx", target: "_blank", rel: "noopener" }, "Recibe el boletín mensual"))),
    h("div", { class: "pie-inicio" },
      h("section", { class: "seccion" },
        h("div", { class: "etq-fila" }, h("h2", { class: "etq" }, "Explora un estado"),
          h("span", { class: "mut", style: { fontSize: "13px" } }, "Sus delitos, sus municipios y su observatorio local")),
        h("div", { class: "estados" }, META.entidades.slice(1).map((e) => h("a", { href: urlDe("variacion", { state: e.codigo }) }, e.nombre)))),
      h("section", { class: "seccion sobre" },
        h("div", { class: "etq-fila" }, h("h2", { class: "etq" }, "Sobre los datos")),
        h("h3", {}, "De dónde vienen"), h("p", {}, "Carpetas de investigación y víctimas del fuero común que publica el Secretariado Ejecutivo del Sistema Nacional de Seguridad Pública (SESNSP)."),
        h("h3", {}, "Cada cuánto"), h("p", {}, `Cada mes, alrededor del día 20. Hoy llegan a ${fechaLarga(CORTE)}.`),
        h("h3", {}, "Cómo se comparan"), h("p", {}, "En tasas por cada 100 mil habitantes. El SESNSP cambió de sistema en 2015 y en 2026; las gráficas marcan ambos cortes."),
        h("a", { class: "texto-enlace", href: `${RAIZ}nota-metodologica/` }, "Nota metodológica →")))));
}

// ── Líneas de tendencia ─────────────────────────────────────────────────────
function filtrosTendencia(d, g, explorar) {
  return barraFiltros([
    selector({ titulo: "Delito", opciones: opcionesDelito(), valor: d.codigo, onCambio: (v) => cambiar({ crime: v, ...sinTramo }) }),
    selector({
      titulo: "Explorar municipios", valor: explorar,
      opciones: [{ value: "", name: "Elige un estado" }, ...conMunicipios().map((x) => ({ value: x.slug, name: x.nombre }))],
      onCambio: (v) => { location.href = urlDe(v ? `tendencia/${v}` : "tendencia", { ...q, states: "0", state: "0" }); },
    }),
    selector({ titulo: "Unidad", opciones: opcionesUnidad(), valor: q.unit, onCambio: (v) => cambiar({ unit: v }) }),
    selector({ titulo: "Indicador", opciones: INDICADORES, valor: q.indicator, onCambio: (v) => cambiar({ indicator: v }) }),
    selector({ titulo: "Agrupación", opciones: opcionesAgrupacion(false), valor: g.value, onCambio: (v) => cambiar({ group: v, ...sinTramo }) }),
  ], [`${d.nombre} · ${g.name.toLowerCase()}`, `${unidad().corto} · ${esTasa() ? "tasa por 100 mil hab." : "números absolutos"}`]);
}

async function vistaTendencia(raiz) {
  const ent = ARG ? entidadPorSlug(ARG) : null;
  if (ent) return vistaTendenciaMunicipal(raiz, ent);
  const g = agrupacion().n <= 0 ? AGRUPACIONES[0] : agrupacion();
  const d = delito(q.crime);
  ajustarUnidad(d);
  let estados = [...new Set(q.state.split(",").map(Number).filter((e) => e >= 0 && e <= 32))].slice(0, 10);
  if (!estados.length) estados = [0];

  const dat = await cargarDelito(d.codigo);
  const u = dat[unidad().key];
  const lista = periodos(g, abs(u.inicio)).reverse();
  const series = estados.map((e, i) => ({ nombre: entidad(e).nombre, color: colorSerie(i), pts: lista.map((p) => suma(serie(u, e), p.k0, p.k1)) }));
  const cont = h("div", { id: "grafica" });

  raiz.append(marco({
    filtros: filtrosTendencia(d, g, ""),
    titulo: d.nombre,
    sub: `${textoIndicador()} · ${unidad().name.toLowerCase()} · ${g.name.toLowerCase()}`,
    princ: [
      chipsSeleccion({ series, sel: estados, etiquetaAgregar: "Agregar entidad",
        items: META.entidades.map((x) => ({ clave: x.codigo, nombre: x.nombre })), alCambiar: (sel) => cambiar({ state: sel.join(",") }) }),
      cont,
    ],
    lateral: [leerGrafica(), usarDatos(() => descargarSeries(`tendencia_${d.codigo}.csv`, lista, series, { delito: d.nombre }))],
  }));
  // La gráfica necesita su ancho real, que solo existe ya insertada en la página.
  return () => graficaPeriodo(cont, lista, series);
}

// /tendencia/<estado>: el total del estado y sus municipios (hasta 10).
async function vistaTendenciaMunicipal(raiz, ent) {
  const g = agrupacion().n <= 0 ? AGRUPACIONES[0] : agrupacion();
  const d = delito(q.crime);
  ajustarUnidad(d);
  const [indice, datEst, datMun] = await Promise.all([cargarIndiceMpal(ent.codigo), cargarDelito(d.codigo), cargarDelitoMpal(ent.codigo, d.codigo)]);
  const pos = new Map(indice.municipios.map((m, i) => [m.codigo, i]));
  let sel = [...new Set(q.states.split(",").map(Number).filter((m) => m === 0 || pos.has(m)))].slice(0, 10);
  if (!sel.length) sel = [0];
  const nombreDe = (m) => (m === 0 ? `Total ${ent.nombre}` : indice.municipios[pos.get(m)].nombre);

  const uEst = datEst[unidad().key], uMun = datMun[unidad().key];
  const lista = periodos(g, abs(uEst.inicio)).reverse();
  const series = sel.map((m, i) => {
    const se = m === 0 ? serie(uEst, ent.codigo) : serie(uMun, pos.get(m));
    return { nombre: nombreDe(m), color: colorSerie(i), pts: lista.map((p) => suma(se, p.k0, p.k1)) };
  });
  const cont = h("div", { id: "grafica" });

  raiz.append(marco({
    filtros: filtrosTendencia(d, g, ent.slug),
    miga: miga({ texto: "Nacional", href: urlDe("tendencia", { ...q, state: ent.codigo, states: "0" }) }, { texto: ent.nombre }),
    titulo: `${d.nombre} en ${ent.nombre}`,
    sub: `${textoIndicador()} · ${unidad().name.toLowerCase()} · ${g.name.toLowerCase()}`,
    princ: [
      avisoSinMunicipal(d),
      chipsSeleccion({ series, sel, etiquetaAgregar: "Agregar municipio",
        items: [{ clave: 0, nombre: `Total ${ent.nombre}` }, ...indice.municipios.map((m) => ({ clave: m.codigo, nombre: m.nombre }))],
        alCambiar: (nuevo) => cambiar({ states: nuevo.join(",") }) }),
      cont,
    ],
    lateral: [leerGrafica(), usarDatos(() => descargarSeries(`tendencia_${ent.slug}_${d.codigo}.csv`, lista, series, { delito: d.nombre }))],
  }));
  return () => graficaPeriodo(cont, lista, series);
}

// ── Mapa de incidencia ──────────────────────────────────────────────────────
function filtrosMapa(d, g, lista, per, ent) {
  return barraFiltros([
    selector({
      titulo: "Entidad", valor: ent ? ent.slug : "",
      opciones: [{ value: "", name: "Total nacional" }, ...conMunicipios().map((x) => ({ value: x.slug, name: x.nombre }))],
      onCambio: (v) => { location.href = urlDe(v ? `mapa/${v}` : "mapa", { ...q, period: "" }); },
    }),
    selector({ titulo: "Delito", opciones: opcionesDelito(), valor: d.codigo, onCambio: (v) => cambiar({ crime: v }) }),
    selector({ titulo: "Unidad", opciones: opcionesUnidad(), valor: q.unit, onCambio: (v) => cambiar({ unit: v, period: "" }) }),
    selector({ titulo: "Indicador", opciones: INDICADORES, valor: q.indicator, onCambio: (v) => cambiar({ indicator: v }) }),
    selector({ titulo: "Periodo", opciones: opcionesPeriodo(lista), valor: per.clave, onCambio: (v) => cambiar({ period: v }) }),
    selector({ titulo: "Agrupación", opciones: opcionesAgrupacion(), valor: g.value, onCambio: (v) => cambiar({ group: v, period: "" }) }),
  ], [`${ent ? ent.nombre : "Nacional"} · ${per.corto}`, `${d.nombre} · ${esTasa() ? "tasa" : unidad().corto.toLowerCase()}`]);
}
const leerMapa = (...extra) => leer("Cómo leer este mapa",
  "Entre más intenso el rojo, mayor el valor. Los colores agrupan valores parecidos (cortes naturales).", ...extra);

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
  const valores = META.entidades.map((x) => valorPeriodo(serie(u, x.codigo), per));
  const irA = (e) => { location.href = urlDe(`mapa/${entidad(e).slug}`, { ...q }); };
  // Como en la plataforma: el estado abre su mapa por municipios.
  const mapa = mapaCoropletico({ geo: geoEstados(), valor: (e) => valores[e], nombre: (e) => entidad(e).nombre,
    etiqueta: `${d.nombre} por entidad, ${per.largo}`, pista: "Clic para ver sus municipios", onClick: irA });
  const items = META.entidades.slice(1).map((x) => ({ clave: x.codigo, nombre: x.nombre, valor: valores[x.codigo], href: urlDe(`mapa/${x.slug}`, { ...q }) }));
  // El valor nacional solo sirve de referencia en tasas; en absolutos es la suma.
  const ref = esTasa() ? { nombre: "Nacional", valor: valores[0] } : null;
  raiz.append(marco({
    filtros: filtrosMapa(d, g, lista, per, null),
    titulo: `${d.nombre} por entidad`,
    sub: `${textoIndicador()} · ${unidad().name.toLowerCase()} · ${per.largo}${per.promedio ? " · promedio mensual" : ""}`,
    princ: [
      mapa.svg, leyenda(mapa.cls),
      caja("Cómo se reparten las 32 entidades",
        distribucion({ items, cls: mapa.cls, referencia: ref, onClick: irA }),
        h("p", { class: "nota" }, `Cada punto es una entidad, con el color de su grupo en el mapa.${ref ? " La línea punteada es la tasa nacional." : ""}`)),
    ],
    lateral: [
      caja(esTasa() ? "Mayor tasa" : "Mayor número", listaMayor(items, 10, ref, urlDe(`variacion/${d.codigo}`, { ...q, crime: d.codigo }))),
      leerMapa("Haz clic en un estado para ver sus municipios.", per.promedio ? "Por sexenio, cada estado muestra el promedio mensual del gobierno elegido (en curso, hasta el último mes con datos)." : null),
      usarDatos(() => bajarCSV(`mapa_${d.codigo}_${per.clave}.csv`, META.entidades.map((x) => ({ inegiEntidad: x.codigo, entidad: x.nombre, delito: d.nombre, unidad: unidad().name, indicador: indicador().name, periodo: per.largo, valor: redondeo(valores[x.codigo]) })))),
    ],
  }));
}

// /mapa/<estado>: sus municipios, su ranking y los observatorios locales.
async function vistaMapaMunicipal(raiz, ent) {
  const g = agrupacion();
  const d = delito(q.crime);
  ajustarUnidad(d);
  const [indice, geo, dat, datEst] = await Promise.all([cargarIndiceMpal(ent.codigo), cargarMapaMpal(ent.codigo), cargarDelitoMpal(ent.codigo, d.codigo), cargarDelito(d.codigo)]);
  const u = dat[unidad().key];
  const lista = u ? periodos(g, abs(u.inicio)) : periodos(g);
  const per = periodoActual(lista);
  const pos = new Map(indice.municipios.map((m, i) => [m.codigo, i]));
  const valor = (m) => (u && pos.has(m) ? valorPeriodo(serie(u, pos.get(m)), per) : null);
  const nombre = (m) => (pos.has(m) ? indice.municipios[pos.get(m)].nombre : String(m));
  const irTendencia = (m) => { location.href = urlDe(`tendencia/${ent.slug}`, { ...q, states: `0,${m}`, group: grupoTendencia(g), ...sinTramo }); };
  const mapa = mapaCoropletico({ geo, valor, nombre, etiqueta: `${d.nombre} en ${ent.nombre} por municipio`, pista: "Clic para ver su tendencia", onClick: irTendencia });

  // Ranking municipal junto al mapa: por tasa o por número, con las dos columnas.
  const tasaDe = (m) => (u && pos.has(m) ? valorPeriodo(serie(u, pos.get(m), "t"), per) : null);
  const numDe = (m) => (u && pos.has(m) ? valorPeriodo(serie(u, pos.get(m), "c"), per) : null);
  const muns = indice.municipios.filter((m) => m.mapa !== false).map((m) => ({ m, tasa: tasaDe(m.codigo), num: numDe(m.codigo) }));
  const panel = h("div", { class: "panel-col" });
  let orden = "tasa";
  function pintarPanel() {
    const top = muns.filter((x) => x[orden] != null).sort((a, b) => b[orden] - a[orden]).slice(0, 10);
    const max = Math.max(...top.map((x) => x[orden]), 0) || 1;
    const cols = { gridTemplateColumns: "22px 1fr 56px 60px 44px" };
    panel.replaceChildren(
      h("div", { class: "etq-fila" }, h("h2", { class: "etq" }, orden === "tasa" ? "Municipios con mayor tasa" : `Municipios con más ${unidad().corto.toLowerCase()}`),
        segmento([["tasa", "Tasa"], ["num", unidad().corto]].map(([k, t]) => h("button", { type: "button", class: orden === k ? "on" : "", onclick: () => { orden = k; pintarPanel(); } }, t)))),
      d.mpal ? h("div", { class: "lista" },
        h("div", { class: "it", style: { ...cols, minHeight: "28px", fontSize: "12px", color: "var(--texto2)" } }, h("span"), h("span", {}, "Municipio"), h("span"), h("span", { style: { textAlign: "right" } }, "Tasa"), h("span", { style: { textAlign: "right" } }, unidad().key === "ci" ? "Carp." : "Víct.")),
        top.map((x, i) => h("a", { class: "it", style: cols, href: urlDe(`tendencia/${ent.slug}`, { ...q, states: `0,${x.m.codigo}`, group: grupoTendencia(g), ...sinTramo }) },
          h("span", { class: "rk" }, i + 1), h("span", {}, x.m.nombre), h("div", { class: "barra-rank", style: { width: `${((x[orden] / max) * 100).toFixed(1)}%` } }),
          h("span", { class: "v" }, x.tasa == null ? "–" : NF2.format(x.tasa)), h("span", { class: "mut", style: { textAlign: "right" } }, x.num == null ? "–" : NF0.format(x.num))))) : null,
      h("a", { class: "btn", href: urlDe(`ranking/${ent.slug}`, { ...q, crime: d.codigo }) }, "Ver el ranking municipal completo"));
  }
  pintarPanel();
  const uEst = datEst[unidad().key];
  const tasaEst = valorPeriodo(serie(uEst, ent.codigo, "t"), per), tasaNac = valorPeriodo(serie(uEst, 0, "t"), per);
  raiz.append(marco({
    filtros: filtrosMapa(d, g, lista, per, ent),
    miga: miga({ texto: "Nacional", href: urlDe("mapa", { ...q }) }, { texto: ent.nombre }),
    titulo: `${d.nombre} en ${ent.nombre}, por municipio`,
    sub: `${textoIndicador()} · ${unidad().name.toLowerCase()} · ${per.largo}${per.promedio ? " · promedio mensual" : ""}`,
    princ: [
      avisoSinMunicipal(d),
      h("div", { class: "mapa-y-panel" }, h("div", { class: "mapa-col" }, mapa.svg, leyenda(mapa.cls)), panel),
    ],
    lateral: [
      leerMapa("En municipios con poca población, unas cuantas carpetas producen tasas muy altas: revisa también el número de carpetas. Haz clic en un municipio para ver su tendencia."),
      caja(ent.nombre,
        h("p", {}, "Tasa estatal: ", h("b", {}, tasaEst == null ? "–" : NF2.format(tasaEst)), " por 100 mil hab."),
        h("p", {}, "Nacional: ", h("b", {}, tasaNac == null ? "–" : NF2.format(tasaNac))),
        h("a", { class: "enlace", href: urlDe(`tendencia/${ent.slug}`, { ...q, states: "0", ...sinTramo }) }, `Ver ${ent.nombre} en la tendencia`, ic("flecha", 16))),
      indice.observatorios.length ? caja("Observatorios locales", indice.observatorios.map((o) => o.sitio
        ? h("a", { class: "enlace", href: /^https?:/.test(o.sitio) ? o.sitio : `https://${o.sitio}`, target: "_blank", rel: "noopener" }, o.nombre, ic("flecha", 16))
        : h("p", {}, o.nombre))) : null,
      usarDatos(() => bajarCSV(`mapa_${ent.slug}_${d.codigo}_${per.clave}.csv`, indice.municipios.map((m) => ({ inegiMunicipio: m.codigo, municipio: m.nombre, entidad: ent.nombre, delito: d.nombre, unidad: unidad().name, indicador: indicador().name, periodo: per.largo, valor: redondeo(valor(m.codigo)) })))),
    ],
  }));
}

// ── Tabla de variación ──────────────────────────────────────────────────────
const leerTabla = (...extra) => leer("Cómo leer esta tabla",
  "Verde: baja. Rojo: sube. La barra crece con el tamaño del cambio.",
  "Los renglones no se suman: algunos delitos contienen a otros. El feminicidio, por ejemplo, está dentro del homicidio doloso.", ...extra);

// Tabla de variación por tipo de delito: una entidad (o un municipio), todos los delitos.
async function vistaVariacion(raiz) {
  const g = agrupacion();
  const e = Math.max(0, Math.min(32, Number(q.state.split(",")[0]) || 0));
  const ent = entidad(e);
  const indice = e > 0 && ent.municipios ? await cargarIndiceMpal(e) : null;
  const mun = indice?.municipios.find((m) => m.codigo === Number(q.municipality)) || null;
  const datos = mun ? await cargarMunicipio(e, mun.codigo) : await cargarEntidad(e);
  const u = unidad();
  // Lo municipal arranca en 2015 y las víctimas en 2014; ofrecer periodos
  // anteriores dejaría la tabla vacía (por sexenio, Peña y antes en víctimas).
  const lista = periodos(g, mun ? abs("2015-01") : g.value === "sexenio" && u.key === "v" ? abs("2014-01") : abs("1997-01"));
  const cx = contextoVariacion(g, lista);

  // Las tablas son referenciales: los componentes se despliegan bajo su
  // delito para leerlo mejor, no para sumarlos.
  const soloEn = (d) => (u.key === "ci" && !d.ci_desde ? " (solo en víctimas)" : u.key === "v" && !d.v_desde ? " (solo en carpetas)" : "");
  const fila = (d) => ({
    ...valoresVariacion(serie(datos.delitos[d.codigo]?.[u.key]), cx),
    nombre: d.padre ? h("span", {}, (d.corto || d.nombre) + soloEn(d)) : [iconoDelito(d.codigo), h("span", {}, d.nombre + soloEn(d))],
    columnas: { entidad: nombreEntidad(e), ...(mun ? { municipio: mun.nombre } : {}), delito: d.nombre },
    // El delito abre su ranking: por entidades en el nacional y por
    // municipios con un estado elegido.
    irA: () => {
      location.href = mun ? urlDe(`tendencia/${ent.slug}`, { ...q, crime: d.codigo, states: `0,${mun.codigo}`, group: grupoTendencia(g), ...sinTramo })
        : e > 0 && ent.municipios ? urlDe(`ranking/${ent.slug}`, { ...q, crime: d.codigo })
          : urlDe(`variacion/${d.codigo}`, { ...q, crime: d.codigo });
    },
    irATendencia: () => {
      location.href = mun ? urlDe(`tendencia/${ent.slug}`, { ...q, crime: d.codigo, states: `0,${mun.codigo}`, group: grupoTendencia(g), ...sinTramo })
        : urlDe("tendencia", { ...q, crime: d.codigo, state: e, group: grupoTendencia(g), ...sinTramo });
    },
  });
  const filas = principales().map((d) => ({ ...fila(d), hijos: componentes(d.codigo).map(fila) }));

  const lugar = mun ? `${mun.nombre}, ${ent.nombre}` : nombreEntidad(e);
  raiz.append(marco({
    filtros: barraFiltros([
      selector({ titulo: "Entidad", valor: e, opciones: opcionesEntidad(), onCambio: (v) => cambiar({ state: v, municipality: "0", period: "" }) }),
      indice ? selector({ titulo: "Municipio", valor: mun ? mun.codigo : 0,
        opciones: [{ value: 0, name: `Total ${ent.nombre}` }, ...indice.municipios.map((m) => ({ value: m.codigo, name: m.nombre }))],
        onCambio: (v) => cambiar({ municipality: v, period: "" }) }) : null,
      selector({ titulo: "Unidad", opciones: UNIDADES, valor: q.unit, onCambio: (v) => cambiar({ unit: v }) }),
      selector({ titulo: "Indicador", opciones: INDICADORES, valor: q.indicator, onCambio: (v) => cambiar({ indicator: v }) }),
      selector({ titulo: "Periodo", opciones: opcionesPeriodo(lista), valor: cx.per.clave, onCambio: (v) => cambiar({ period: v }) }),
      selector({ titulo: "Agrupación", opciones: opcionesAgrupacion(), valor: g.value, onCambio: (v) => cambiar({ group: v, period: "" }) }),
    ], [`${lugar} · ${cx.per.corto}`, `${u.corto} · ${esTasa() ? "tasa por 100 mil hab." : "números absolutos"}`]),
    miga: mun ? miga({ texto: ent.nombre, href: urlDe("variacion", { ...q, municipality: "0" }) }, { texto: mun.nombre }) : null,
    titulo: e === 0 ? "Variación por tipo de delito" : `Variación por tipo de delito en ${lugar}`,
    sub: `${lugar} · ${subtituloComparacion(cx)} · ${textoIndicador().toLowerCase()}`,
    princ: [avisosSexenio(cx, filas), tablaVariacion({ columna: "Delito", cx, filas })],
    ancha: true,
    lateral: [
      leerTabla(e > 0 && ent.municipios && !mun ? "Haz clic en un delito para ver el ranking de sus municipios; en la flecha, para ver sus componentes." : "Haz clic en un delito para ver el ranking de entidades; en la flecha, para ver sus componentes.", ...leerSexenio(cx)),
      usarDatos(() => bajarCSV(`variacion_${mun ? mun.codigo : e}_${cx.per.clave}.csv`, csvVariacion(cx, filas))),
    ],
  }));
}

/** Filtros de los rankings (estatal y municipal). */
function filtrosRanking(d, g, lista, cx, onDelito) {
  return barraFiltros([
    selector({ titulo: "Delito", opciones: opcionesDelito(), valor: d.codigo, onCambio: onDelito }),
    selector({ titulo: "Unidad", opciones: opcionesUnidad(), valor: q.unit, onCambio: (v) => cambiar({ unit: v, period: "" }) }),
    selector({ titulo: "Indicador", opciones: INDICADORES, valor: q.indicator, onCambio: (v) => cambiar({ indicator: v }) }),
    selector({ titulo: "Periodo", opciones: opcionesPeriodo(lista), valor: cx.per.clave, onCambio: (v) => cambiar({ period: v }) }),
    selector({ titulo: "Agrupación", opciones: opcionesAgrupacion(), valor: g.value, onCambio: (v) => cambiar({ group: v, period: "" }) }),
  ], [`${d.nombre} · ${cx.per.corto}`, `${unidad().corto} · ${esTasa() ? "tasa por 100 mil hab." : "números absolutos"}`]);
}
/** Ordena de mayor a menor, numera e inserta el renglón de referencia en su lugar. */
function ordenarConReferencia(filas, ref) {
  const orden = filas.sort((a, b) => (b.act ?? -Infinity) - (a.act ?? -Infinity)).map((f, i) => ({ ...f, rango: i + 1 }));
  if (ref && ref.act != null && esTasa()) {
    const i = orden.findIndex((f) => (f.act ?? -Infinity) < ref.act);
    orden.splice(i < 0 ? orden.length : i, 0, { ...ref, ref: true });
  }
  return orden;
}

// Ranking por entidades: un delito, las 32 entidades de mayor a menor.
async function vistaRanking(raiz, codigo) {
  const g = agrupacion();
  const d = delito(codigo);
  ajustarUnidad(d);
  const u = unidad();
  const dat = await cargarDelito(d.codigo);
  const lista = periodos(g, abs(dat[u.key].inicio));
  const cx = contextoVariacion(g, lista);
  const filas = ordenarConReferencia(META.entidades.slice(1).map((x) => ({
    ...valoresVariacion(serie(dat[u.key], x.codigo), cx),
    nombre: h("span", {}, x.nombre),
    columnas: { entidad: x.nombre, delito: d.nombre },
    // De la entidad, a su tabla por tipo de delito.
    irA: () => { location.href = urlDe("variacion", { ...q, crime: 0, state: x.codigo }); },
  })), { ...valoresVariacion(serie(dat[u.key], 0), cx), nombre: h("span", {}, "Nacional") });
  filas.filter((f) => !f.ref).forEach((f) => { f.columnas = { posicion: f.rango, ...f.columnas }; });
  const ref = filas.find((f) => f.ref);

  raiz.append(marco({
    filtros: filtrosRanking(d, g, lista, cx, (v) => { location.href = urlDe(`variacion/${v}`, { ...q, crime: v }); }),
    miga: miga({ texto: "Variación", href: urlDe("variacion", { ...q, state: "0" }) }, { texto: "Ranking de entidades" }),
    titulo: `Ranking de entidades: ${d.nombre.toLowerCase()}`,
    sub: `${textoIndicador()} · ${unidad().name.toLowerCase()} · ${subtituloComparacion(cx)}`,
    princ: [avisosSexenio(cx, filas), tablaVariacion({ columna: "Entidad", cx, filas, ranking: true })],
    ancha: true,
    lateral: [
      ref ? leer("Referencia", `Nacional: ${fmt(ref.act)} por 100 mil hab. en ${enPeriodo(cx)}. El renglón sombreado marca dónde queda en el ranking.`) : null,
      leer("Cómo leer este ranking", `Ordenado por el valor de ${enPeriodo(cx)}. Verde: baja; rojo: sube.`, ...leerSexenio(cx), "Haz clic en una entidad para ver su tabla por tipo de delito."),
      usarDatos(() => bajarCSV(`ranking_${d.codigo}_${cx.per.clave}.csv`, csvVariacion(cx, filas))),
    ],
  }));
}

// /ranking/<estado>: un delito, los municipios del estado de mayor a menor.
async function vistaRankingMunicipal(raiz, ent) {
  const g = agrupacion();
  const d = delito(q.crime);
  ajustarUnidad(d);
  const u = unidad();
  const [indice, dat, datEst] = await Promise.all([cargarIndiceMpal(ent.codigo), cargarDelitoMpal(ent.codigo, d.codigo), cargarDelito(d.codigo)]);
  const um = dat[u.key];
  const lista = periodos(g, um ? abs(um.inicio) : abs("2015-01"));
  const cx = contextoVariacion(g, lista);
  const filas = ordenarConReferencia(indice.municipios.map((m, i) => ({
    ...valoresVariacion(um ? serie(um, i) : null, cx),
    nombre: h("span", {}, m.nombre),
    columnas: { municipio: m.nombre, entidad: ent.nombre, delito: d.nombre },
    // Del municipio, a su tabla por tipo de delito.
    irA: () => { location.href = urlDe("variacion", { ...q, crime: 0, state: ent.codigo, municipality: m.codigo }); },
  })), { ...valoresVariacion(serie(datEst[u.key], ent.codigo), cx), nombre: h("span", {}, `Total ${ent.nombre}`) });
  filas.filter((f) => !f.ref).forEach((f) => { f.columnas = { posicion: f.rango, ...f.columnas }; });
  const ref = filas.find((f) => f.ref);

  raiz.append(marco({
    filtros: filtrosRanking(d, g, lista, cx, (v) => cambiar({ crime: v })),
    miga: miga({ texto: "Variación", href: urlDe("variacion", { ...q, state: ent.codigo, municipality: "0" }) }, { texto: ent.nombre }, { texto: "Ranking municipal" }),
    titulo: `Ranking municipal de ${ent.nombre}: ${d.nombre.toLowerCase()}`,
    sub: `${textoIndicador()} · ${unidad().name.toLowerCase()} · ${subtituloComparacion(cx)}`,
    princ: [d.mpal ? null : h("p", { class: "aviso" }, `El SESNSP no publica ${d.nombre.toLowerCase()} a nivel municipal.`), avisosSexenio(cx, filas), tablaVariacion({ columna: "Municipio", cx, filas, ranking: true })],
    ancha: true,
    lateral: [
      ref ? leer("Referencia", `Total de ${ent.nombre}: ${fmt(ref.act)} por 100 mil hab. en ${enPeriodo(cx)}. El renglón sombreado marca dónde queda.`) : null,
      leer("Cómo leer este ranking", `Ordenado por el valor de ${enPeriodo(cx)}. Verde: baja; rojo: sube.`, ...leerSexenio(cx),
        "En municipios con poca población, unas cuantas carpetas producen tasas muy altas.", "Haz clic en un municipio para ver su tabla por tipo de delito."),
      usarDatos(() => bajarCSV(`ranking_${ent.slug}_${d.codigo}_${cx.per.clave}.csv`, csvVariacion(cx, filas))),
    ],
  }));
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

async function vistaComparar(raiz) {
  const g = agrupacion().n <= 0 ? AGRUPACIONES[0] : agrupacion();
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
    return { nombre: uo ? d.nombre : `${d.nombre} (no se publica en ${u.name.toLowerCase()})`, color: colorSerie(i), pts: lista.map((p) => suma(serie(uo), p.k0, p.k1)) };
  });
  const cont = h("div", { id: "grafica" });

  raiz.append(marco({
    filtros: barraFiltros([
      selector({ titulo: "Entidad", valor: e, opciones: opcionesEntidad(), onCambio: (v) => cambiar({ state: v }) }),
      selector({ titulo: "Unidad", opciones: UNIDADES, valor: q.unit, onCambio: (v) => cambiar({ unit: v }) }),
      selector({ titulo: "Indicador", opciones: INDICADORES, valor: q.indicator, onCambio: (v) => cambiar({ indicator: v }) }),
      selector({ titulo: "Agrupación", opciones: opcionesAgrupacion(false), valor: g.value, onCambio: (v) => cambiar({ group: v, ...sinTramo }) }),
    ], [`${nombreEntidad(e)} · ${g.name.toLowerCase()}`, `${u.corto} · ${esTasa() ? "tasa por 100 mil hab." : "números absolutos"}`]),
    titulo: "Comparar delitos",
    sub: `${nombreEntidad(e)} · ${textoIndicador().toLowerCase()} · ${u.name.toLowerCase()}`,
    princ: [
      chipsSeleccion({ series, sel, max: 5, etiquetaAgregar: "Agregar delito",
        items: META.delitos.map((d) => ({ clave: d.codigo, nombre: d.nombre, nivel: d.padre ? 1 : 0 })),
        alCambiar: (nuevo) => cambiar({ crimes: nuevo.join(","), ...sinTramo }) }),
      cont,
    ],
    lateral: [
      caja("Comparaciones sugeridas", COMPARACIONES.map((c) => {
        const activa = c.delitos.join(",") === sel.join(",");
        return h("button", { type: "button", class: "enlace", "aria-pressed": String(activa), style: activa ? { color: "var(--acento-texto)" } : null,
          onclick: () => cambiar({ crimes: c.delitos.join(","), unit: c.unit, ...sinTramo }) }, c.nombre, activa ? ic("palomita", 16) : ic("flecha", 16));
      })),
      leer("Cómo leer esta gráfica",
        "Algunos delitos están contenidos en otros (por ejemplo, el feminicidio forma parte del homicidio doloso): las series se comparan, no se suman.",
        "Los atajos fijan el periodo de cada sexenio; con las manijas de la barra eliges cualquier otro tramo."),
      usarDatos(() => descargarSeries(`comparar_${e}.csv`, lista, series, { entidad: nombreEntidad(e) })),
    ],
  }));
  return () => graficaPeriodo(cont, lista, series);
}

// ── Descargar datos ─────────────────────────────────────────────────────────
async function vistaDescargar(raiz) {
  const g = agrupacion().value === "sexenio" ? AGRUPACIONES[0] : agrupacion();
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
  const periodosDe = (d) => periodosSel.filter((p) => p.k0 >= abs(d.ci_desde || d.v_desde));
  const total = delitosSel.reduce((n, d) => n + periodosDe(d).length * entidadesSel.length, 0);
  let busqueda = "";

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
  const fila = (nombre, accion, texto) => h("div", { class: "fila-formato" }, h("span", { style: { fontWeight: 500 } }, nombre), accion, texto ? h("span", { class: "nota" }, texto) : null);
  const registros = (n) => `${NF0.format(n)} ${n === 1 ? "registro" : "registros"}`;
  const conteo = h("p", { style: { fontWeight: 500 } }, registros(total));
  raiz.append(marco({
    titulo: "Descargar bases de datos",
    lateralPrimero: true,
    sub: "Elige delito, entidad y periodo en la columna derecha, y descarga en el formato que necesites.",
    princ: [
      h("div", { class: "resumen-filtros" }, [crime === todos ? "Todos los delitos" : delito(crime).nombre, est === todos ? "Todas las entidades" : nombreEntidad(est), g.name, per ? mayus(per.largo) : "Todos los periodos"].map((t) => h("span", {}, t))),
      h("div", { class: "formatos" },
        h("h2", {}, "Archivo plano"),
        fila("CSV", h("button", { type: "button", class: "btn", onclick: async () => bajarCSV("delitosmexico.csv", await filas()) }, ic("descargar", 16), "Descargar")),
        fila("JSON", h("button", { type: "button", class: "btn", onclick: async () => bajar("delitosmexico.json", JSON.stringify(await filas()), "application/json") }, ic("descargar", 16), "Descargar")),
        h("h2", {}, "Archivo geográfico"),
        fila("GeoJSON · entidades", h("a", { class: "btn", href: `${RAIZ}descargas/estados.geojson`, download: "" }, ic("descargar", 16), "Descargar")),
        fila("GeoJSON · municipios", h("a", { class: "btn", href: `${RAIZ}descargas/municipios.geojson`, download: "" }, ic("descargar", 16), "Descargar")),
        h("h2", {}, "Metadatos"),
        fila("Nota metodológica", h("a", { class: "btn", href: `${RAIZ}nota-metodologica/` }, "Ver"))),
    ],
    lateral: [
      caja("Filtrar", conteo,
        h("input", { type: "search", class: "campo", placeholder: "Palabras clave", "aria-label": "Filtrar por palabras clave",
          oninput: (ev) => {
            busqueda = ev.target.value;
            const t = busqueda.trim().toLowerCase();
            const n = !t ? total : delitosSel.reduce((acc, d) => acc + periodosDe(d).length * entidadesSel.filter((x) => `${x.nombre} ${d.nombre}`.toLowerCase().includes(t)).length, 0);
            conteo.textContent = registros(n);
          } }),
        selector({ titulo: "Delito", valor: crime, opciones: [{ value: todos, name: "Todos los delitos" }, ...opcionesDelito()], onCambio: (v) => cambiar({ crime: v }) }),
        selector({ titulo: "Entidad", valor: est, opciones: [{ value: todos, name: "Todas las entidades" }, ...opcionesEntidad()], onCambio: (v) => cambiar({ state: v }) }),
        selector({ titulo: "Agrupación", valor: g.value, opciones: opcionesAgrupacion(true, false), onCambio: (v) => cambiar({ group: v, period: "" }) }),
        selector({ titulo: "Periodo", valor: per ? per.clave : todos, opciones: [{ value: todos, name: "Todos los periodos" }, ...opcionesPeriodo(lista)], onCambio: (v) => cambiar({ period: v }) }),
        h("button", { type: "button", class: "enlace", onclick: () => cambiar({ crime: todos, state: todos, group: "month", period: todos }) }, "Limpiar filtros", ic("cerrar", 16))),
    ],
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Marco común: tema, menú, pie
// ═══════════════════════════════════════════════════════════════════════════
// ── Tema ────────────────────────────────────────────────────────────────────
// Por omisión sigue la configuración del dispositivo (y cambia con ella);
// quien elige claro u oscuro en el sitio lo conserva. index.html aplica lo
// mismo antes de pintar, para que no parpadee.
const CLAVE_TEMA = "delitosmexico-tema";
const sistemaOscuro = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : { matches: false };
const OPCIONES_TEMA = [
  { value: "auto", name: "Automático, como tu dispositivo", corto: "Automático" },
  { value: "claro", name: "Claro", corto: "Claro" },
  { value: "oscuro", name: "Oscuro", corto: "Oscuro" },
];
function temaElegido() {
  try { return localStorage.getItem(CLAVE_TEMA) || "auto"; } catch (e) { return "auto"; }
}
function aplicarTema() {
  const t = temaElegido();
  const esOscuro = t === "oscuro" || (t !== "claro" && sistemaOscuro.matches);
  if (esOscuro === oscuro()) return;
  document.body.classList.toggle("oscuro", esOscuro);
  if (META) pintar();   // mapas y series usan colores por tema
}
function elegirTema(t) {
  try { if (t === "auto") localStorage.removeItem(CLAVE_TEMA); else localStorage.setItem(CLAVE_TEMA, t); } catch (e) { /* sin almacenamiento */ }
  aplicarTema();
}

function modalInsertar() {
  const url = new URL(location.href);
  url.searchParams.set("iframe", "1");
  const codigo = `<iframe src="${url}" width="100%" height="700" frameborder="0" title="Delitos México"></iframe>`;
  const cerrar = () => fondo.remove();
  const fondo = h("div", { class: "modal-fondo", onclick: (ev) => { if (ev.target === fondo) cerrar(); }, onkeydown: (ev) => { if (ev.key === "Escape") cerrar(); } },
    h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": "Insertar en tu sitio" },
      h("h3", {}, "Insertar en tu sitio"),
      h("p", { class: "mut" }, "Copia este código y pégalo en tu página para mostrar esta vista con los filtros actuales:"),
      h("textarea", { readonly: true, onfocus: (ev) => ev.target.select() }, codigo),
      h("div", { style: { display: "flex", justifyContent: "flex-end" } }, h("button", { type: "button", class: "btn", onclick: cerrar }, "Cerrar"))));
  document.body.append(fondo);
  fondo.querySelector("textarea").focus();
}

function menuMovil() {
  const cerrar = () => fondo.remove();
  const fondo = h("div", { class: "hoja-menu", onclick: (ev) => { if (ev.target === fondo) cerrar(); }, onkeydown: (ev) => { if (ev.key === "Escape") cerrar(); } },
    h("div", { class: "hoja", role: "dialog", "aria-modal": "true", "aria-label": "Menú" },
      h("div", { style: { display: "flex", justifyContent: "flex-end" } }, h("button", { type: "button", class: "btn-ic", "aria-label": "Cerrar menú", onclick: cerrar }, ic("cerrar", 22))),
      h("a", { class: "enlace", href: `${RAIZ}nota-metodologica/` }, "Metodología", ic("flecha", 16)),
      h("button", { type: "button", class: "enlace", onclick: () => { cerrar(); modalInsertar(); } }, "Insertar en tu sitio", h("span", { "aria-hidden": "true" }, "</>")),
      h("a", { class: "enlace", href: "https://onc.org.mx", target: "_blank", rel: "noopener" }, "Boletín del ONC", ic("flecha", 16)),
      h("div", { class: "tema-movil" }, h("span", {}, "Tema"),
        segmento(OPCIONES_TEMA.map((o) => h("button", { type: "button", class: temaElegido() === o.value ? "on" : null,
          "aria-pressed": String(temaElegido() === o.value), onclick: () => { cerrar(); elegirTema(o.value); } }, o.corto)))),
      h("a", { class: "enlace", href: "https://onc.org.mx", target: "_blank", rel: "noopener" }, "Observatorio Nacional Ciudadano", ic("flecha", 16))));
  document.body.append(fondo);
  fondo.querySelector("button").focus();
}

function conectarMarco() {
  document.addEventListener("click", (ev) => {
    const a = ev.target.closest("[data-accion]");
    if (!a) return;
    const acc = a.dataset.accion;
    if (acc === "insertar") modalInsertar();
    if (acc === "tema") abrirLista({ ancla: a, titulo: "Tema", opciones: OPCIONES_TEMA, valor: temaElegido(), onElegir: elegirTema });
    if (acc === "menu") menuMovil();
  });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") cerrarLista(); });
  // Si el dispositivo cambia de claro a oscuro (p. ej. al anochecer), el sitio lo sigue.
  sistemaOscuro.addEventListener?.("change", aplicarTema);
  // Solo se repinta si cambia el ancho (en celular, la barra del navegador cambia el alto).
  let t, ancho = innerWidth;
  window.addEventListener("resize", () => {
    if (innerWidth === ancho) return;
    ancho = innerWidth;
    clearTimeout(t); t = setTimeout(pintar, 150);
  });
}

function marcarMenu() {
  for (const a of document.querySelectorAll(".rail a")) {
    // El ranking (estatal y municipal) es parte de la tabla de variación.
    const on = a.dataset.vista === (VISTA === "ranking" ? "variacion" : VISTA);
    a.classList.toggle("on", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    // Al cambiar de vista se conservan los filtros que aplican a ambas.
    if (a.dataset.vista) a.href = urlDe(a.dataset.vista, { unit: q.unit === DEFAULTS.unit ? "" : q.unit, indicator: q.indicator === DEFAULTS.indicator ? "" : q.indicator, crime: q.crime === "todos" || q.crime === "0" ? "" : q.crime });
  }
}

const VISTAS = { "": vistaInicio, tendencia: vistaTendencia, mapa: vistaMapa, variacion: vistaVariacion, comparar: vistaComparar, descargar: vistaDescargar };
let turno = 0;
async function pintar() {
  const yo = ++turno;
  tip.ocultar();
  cerrarLista();
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
    nueva.replaceChildren(h("p", { class: "aviso", style: { margin: "40px" } }, "No se pudieron cargar los datos. Intenta recargar la página."));
  }
  if (yo !== turno) return;          // llegó otra selección mientras cargaba
  raiz.replaceChildren(nueva);
  if (typeof despues === "function") despues();
}

async function iniciar() {
  leerParams();
  if (q.iframe) document.body.classList.add("iframe");
  conectarMarco();
  try {
    [META, MAPA] = await Promise.all([cargar("datos/meta.json"), cargar("datos/mapa.json")]);
  } catch (err) {
    $("#vista").replaceChildren(h("p", { class: "aviso", style: { margin: "40px" } }, "No se pudieron cargar los datos. Intenta recargar la página."));
    return;
  }
  CORTE = abs(META.corte);
  const gen = new Date(META.generado);
  $("#pie-datos").textContent = `Datos actualizados a ${MESES_LARGO[mes(CORTE)]} de ${anio(CORTE)}, publicados el ${gen.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}.`;
  $("#pie-fuente").href = META.fuente_url;
  pintar();
}

iniciar();
