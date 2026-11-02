const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Aparición al hacer scroll. El vidrio de cada panel reacciona a la clase .dentro desde liquido.ts
const observador = new IntersectionObserver(
  (entradas) => {
    for (const e of entradas) {
      if (e.isIntersecting) {
        e.target.classList.add('dentro');
        observador.unobserve(e.target);
      }
    }
  },
  { threshold: 0.08 },
);
document.querySelectorAll('[data-aparecer], .panel[data-glass]').forEach((el) => observador.observe(el));
requestAnimationFrame(() => document.querySelector('.heroe')?.classList.add('cargado'));

// Indicador de la barra: sigue a la sección que ocupa el centro de la pantalla
const nav = document.querySelector('nav')!;
const indicador = nav.querySelector<HTMLElement>('.indicador')!;
const enlaces = [...nav.querySelectorAll<HTMLAnchorElement>('a')];

function marcar(enlace?: HTMLAnchorElement) {
  enlaces.forEach((a) => a.removeAttribute('aria-current'));
  if (!enlace) {
    indicador.style.setProperty('--visible', '0');
    return;
  }
  enlace.setAttribute('aria-current', 'true');
  indicador.style.setProperty('--x', `${enlace.offsetLeft}px`);
  indicador.style.setProperty('--ancho', `${enlace.offsetWidth}px`);
  indicador.style.setProperty('--visible', '1');
}

const secciones = new IntersectionObserver(
  (entradas) => {
    for (const e of entradas) {
      if (e.isIntersecting) marcar(enlaces.find((a) => a.hash === `#${e.target.id}`));
    }
  },
  { rootMargin: '-50% 0px -50% 0px' },
);
document.querySelectorAll('main > section').forEach((s) => secciones.observe(s));
addEventListener('resize', () => marcar(enlaces.find((a) => a.hasAttribute('aria-current'))));

// Demo: cola sin conexión. Reproduce el flujo de la app: guardar, enviar en orden y no duplicar
const tipos = ['entrada', 'inicio de descanso', 'fin de descanso', 'salida'];
const espera = (ms: number) => new Promise((r) => setTimeout(r, reducido ? 0 : ms));

type Marca = { uuid: string; tipo: string; fila: HTMLLIElement };

const senal = $<HTMLInputElement>('senal');
const marcarBtn = $<HTMLButtonElement>('marcar');
const reintentar = $<HTMLButtonElement>('reintentar');
const lista = $<HTMLOListElement>('cola');
const pendientes: Marca[] = [];
const recibidas = new Set<string>();
let ultima: Marca | undefined;
let turno = 0;
let enviando = false;

function pintarFila(m: Marca, clase: string, estado: string) {
  m.fila.innerHTML = '';
  const nombre = document.createElement('span');
  nombre.textContent = `${m.tipo} · ${m.uuid}`;
  const etiqueta = document.createElement('span');
  etiqueta.className = clase;
  etiqueta.textContent = estado;
  m.fila.append(nombre, etiqueta);
}

async function vaciarCola() {
  if (enviando) return;
  enviando = true;
  while (senal.checked && pendientes.length) {
    const m = pendientes[0];
    pintarFila(m, 'espera', 'enviando…');
    await espera(650);
    if (!senal.checked) {
      pintarFila(m, 'espera', 'en cola');
      break;
    }
    recibidas.add(m.uuid);
    pendientes.shift();
    pintarFila(m, 'listo', '201 guardado');
    $('servidor').textContent = String(recibidas.size);
    ultima = m;
    reintentar.disabled = false;
  }
  enviando = false;
}

marcarBtn.addEventListener('click', () => {
  const m: Marca = {
    uuid: Math.random().toString(16).slice(2, 8),
    tipo: tipos[turno % tipos.length],
    fila: document.createElement('li'),
  };
  turno += 1;
  marcarBtn.textContent = `Marcar ${tipos[turno % tipos.length]}`;
  pintarFila(m, 'espera', 'en cola');
  lista.append(m.fila);
  while (lista.children.length > 4) {
    if (lista.firstElementChild === pendientes[0]?.fila) break;
    lista.firstElementChild?.remove();
  }
  pendientes.push(m);
  vaciarCola();
});

reintentar.addEventListener('click', async () => {
  if (!ultima) return;
  const m = ultima;
  if (!senal.checked) {
    pintarFila(m, 'espera', 'sin señal');
    await espera(900);
    pintarFila(m, 'listo', '201 guardado');
    return;
  }
  pintarFila(m, 'espera', 'reenviando…');
  await espera(600);
  pintarFila(m, 'listo', 'ya recibida: no se duplica');
});

senal.addEventListener('change', () => {
  $('senal-texto').textContent = senal.checked ? 'Con señal' : 'Sin señal';
  vaciarCola();
});

// Demo: cálculo de una quincena con las reglas de docs/reglas-calculo.md, solo para jornada diurna
const BONO = 125;
const IGSS = 0.0483;
const JORNADA_DIURNA = 8;
const quetzales = (n: number) =>
  `Q${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const horas = $<HTMLInputElement>('horas');
const dias = $<HTMLInputElement>('dias');
const tarifa = $<HTMLInputElement>('tarifa');
let netoMostrado = 0;
let animacion = 0;

function calcular() {
  const h = +horas.value;
  const d = +dias.value;
  const t = +tarifa.value;
  const ordinarias = Math.min(h, JORNADA_DIURNA) * d;
  const extra = Math.max(h - JORNADA_DIURNA, 0) * d;
  const bruto = ordinarias * t + extra * t * 1.5;
  const igss = bruto * IGSS;
  const neto = Math.round((bruto - igss + BONO) * 100) / 100;

  $('s-horas').textContent = String(h);
  $('s-dias').textContent = String(d);
  $('s-tarifa').textContent = `Q${t}`;
  $('r-ord').textContent = `${ordinarias} h`;
  $('r-ext').textContent = `${extra} h`;
  $('r-bruto').textContent = quetzales(bruto);
  $('r-igss').textContent = `−${quetzales(igss)}`;

  cancelAnimationFrame(animacion);
  const desde = netoMostrado;
  const inicio = performance.now();
  const paso = (ahora: number) => {
    const avance = reducido ? 1 : Math.min((ahora - inicio) / 350, 1);
    netoMostrado = avance === 1 ? neto : desde + (neto - desde) * (1 - (1 - avance) ** 3);
    $('r-neto').textContent = quetzales(netoMostrado);
    if (avance < 1) animacion = requestAnimationFrame(paso);
  };
  paso(inicio);
}
$('demo-calculo').addEventListener('input', calcular);
$('demo-calculo').addEventListener('submit', (e) => e.preventDefault());
calcular();

// Copiar el correo
const copiar = $<HTMLButtonElement>('copiar');
const textoCorreo = $('correo-texto');
let restaurar: ReturnType<typeof setTimeout>;
copiar.addEventListener('click', async () => {
  const correo = copiar.dataset.correo!;
  try {
    await navigator.clipboard.writeText(correo);
    textoCorreo.textContent = 'Correo copiado';
  } catch {
    location.href = `mailto:${correo}`;
    return;
  }
  clearTimeout(restaurar);
  restaurar = setTimeout(() => (textoCorreo.textContent = correo), 1600);
});
