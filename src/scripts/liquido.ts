// Fondo topográfico y vidrio líquido en WebGL2.
// Primer pase: calcula la altura del terreno en una textura pequeña, unas 30 veces por segundo.
// Segundo pase: a resolución completa dibuja curvas y color a partir de esa altura, y define el vidrio
// como un campo de distancia que deforma lo que tiene detrás. No recalcula el ruido por cada píxel.

const MAX_PANELES = 12;
const MAX_GOTAS = 4;
const ESCALA_ALTURA = 0.5;
const INTERVALO_ALTURA = 33;
const INTERVALO_REPOSO = 32;

const VERTICES = `#version 300 es
void main() {
  vec2 v = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(v * 2.0 - 1.0, 0.0, 1.0);
}`;

const ALTURA = `#version 300 es
precision highp float;
uniform vec2 uTam;
uniform float uEscala, uTiempo, uScroll;
out vec4 color;

// Hash con enteros: la versión típica con sin() deja cortes en el terreno en algunas GPU, como Intel UHD
float azar(vec2 p) {
  uvec2 q = uvec2(ivec2(p)) * uvec2(1597334677u, 3812015801u);
  return float((q.x ^ q.y) * 1597334677u) / 4294967295.0;
}
float ruido(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(azar(i), azar(i + vec2(1, 0)), f.x), mix(azar(i + vec2(0, 1)), azar(i + vec2(1, 1)), f.x), f.y);
}
float terreno(vec2 p) {
  float h = 0.0, a = 0.55;
  for (int i = 0; i < 4; i++) {
    h += a * ruido(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p;
    a *= 0.48;
  }
  return h;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uTam.y * uEscala - gl_FragCoord.y) / uEscala;
  vec2 mundo = (p + vec2(0.0, uScroll * 0.4)) / 460.0;
  color = vec4(terreno(mundo + vec2(uTiempo * 0.012, -uTiempo * 0.007)), 0.0, 0.0, 1.0);
}`;

const VIDRIO = `#version 300 es
precision highp float;
uniform vec2 uTam;
uniform float uDpr, uScroll, uTextoA, uTextoAlto;
uniform vec3 uRaton, uTono;
uniform sampler2D uAltura, uTexto;
uniform int uN, uNG;
uniform vec4 uP[${MAX_PANELES}];
uniform float uR[${MAX_PANELES}];
uniform vec3 uG[${MAX_GOTAS}];
out vec4 color;

float caja(vec2 p, vec2 m, float r) {
  vec2 q = abs(p) - m + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float unir(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
float paneles(vec2 p) {
  float d = 1e4;
  for (int i = 0; i < uN; i++) d = min(d, caja(p - uP[i].xy, uP[i].zw, uR[i]));
  return d;
}
float gotas(vec2 p) {
  float d = 1e4;
  for (int i = 0; i < uNG; i++) d = unir(d, length(p - uG[i].xy) - uG[i].z, 70.0);
  return d;
}
float escena(vec2 p) { return unir(paneles(p), gotas(p), 30.0); }

float altura(vec2 q) {
  float h = textureLod(uAltura, vec2(q.x, uTam.y - q.y) / uTam, 0.0).r;
  vec2 a = q - uRaton.xy;
  return h + uRaton.z * 0.12 * exp(-dot(a, a) / 30000.0);
}
vec3 tierra(float h) {
  float calor = smoothstep(0.42, 0.88, h);
  return vec3(0.046, 0.046, 0.042) + uTono * (calor * calor * 0.34 + smoothstep(0.75, 1.0, h) * 0.08);
}
vec3 relieve(float h, vec2 q, float ancho) {
  float n = h * 15.0;
  float linea = 1.0 - min(abs(fract(n - 0.5) - 0.5) / ancho, 1.0);
  float mayor = 1.0 - min(abs(fract(n / 5.0 - 0.5) - 0.5) / (ancho / 5.0), 1.0);
  vec3 c = tierra(h) + mix(vec3(0.96, 0.94, 0.9), uTono, 0.35) * (linea * 0.09 + mayor * 0.18);
  if (uTextoA > 0.0 && q.y + uScroll < uTextoAlto) {
    float a = textureLod(uTexto, vec2(q.x / uTam.x, (q.y + uScroll) / uTextoAlto), 0.0).a;
    c = mix(c, vec3(0.957, 0.937, 0.902), a * uTextoA);
  }
  return c;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uTam.y * uDpr - gl_FragCoord.y) / uDpr;
  // El grosor de línea se calcula aquí, fuera de los if: dentro no hay derivadas fiables
  float h = altura(p);
  float ancho = max(fwidth(h * 15.0), 1e-3);
  vec3 c = relieve(h, p, ancho);

  float dPanel = paneles(p);
  float dGota = gotas(p);
  float d = unir(dPanel, dGota, 30.0);

  // Sombra desplazada hacia abajo: solo cerca del vidrio
  if (d > 0.0 && d < 110.0) c *= 1.0 - 0.34 * exp(-max(escena(p - vec2(0.0, 10.0)), 0.0) / 26.0);

  if (d < 1.5) {
    float esGota = smoothstep(-10.0, 10.0, dPanel - dGota);
    float bisel = mix(26.0, 96.0, esGota);
    vec3 v;
    float borde = 1.0 - clamp(-d / bisel, 0.0, 1.0);

    if (borde <= 0.0 && esGota <= 0.0) {
      // Centro de un panel: esmerilado y plano, sin deformación
      v = mix(tierra(h), vec3(0.034, 0.034, 0.036), 0.5) + 0.018;
    } else {
      vec2 e = vec2(1.5, 0.0);
      vec2 g = vec2(escena(p + e.xy) - escena(p - e.xy), escena(p + e.yx) - escena(p - e.yx));
      g /= max(length(g), 1e-4);
      float fuerza = pow(borde, 2.4) * mix(30.0, 92.0, esGota);

      vec3 nitido = vec3(0.0);
      if (esGota > 0.0) {
        // Aberración cromática muy leve: los canales se doblan casi igual
        vec2 q = p - g * fuerza;
        vec2 qG = p - g * fuerza * 1.012;
        vec2 qB = p - g * fuerza * 1.024;
        nitido = vec3(
          relieve(altura(q), q, ancho).r,
          relieve(altura(qG), qG, ancho).g,
          relieve(altura(qB), qB, ancho).b);
      }
      vec3 esmerilado = mix(tierra(altura(p - g * fuerza)), vec3(0.034, 0.034, 0.036), 0.5);
      v = mix(esmerilado, nitido, esGota) + 0.018;

      vec2 luz = normalize(vec2(-0.55, -0.83));
      float cara = dot(g, luz);
      v += pow(borde, 5.0) * (0.04 + 0.2 * max(cara, 0.0) + 0.08 * max(-cara, 0.0));
      v += smoothstep(1.6, 0.0, abs(d + 0.8)) * (0.12 + 0.38 * pow(max(cara, 0.0), 2.0) + 0.14 * pow(max(-cara, 0.0), 3.0));
    }
    c = mix(c, v, smoothstep(0.8, -0.8, d));
  }

  c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.012;
  color = vec4(c, 1.0);
}`;

const TONO_FRIO = [0.1, 0.3, 0.36];
const TONO_CALIDO = [0.62, 0.36, 0.2];

function iniciar() {
  const lienzo = document.getElementById('liquido') as HTMLCanvasElement | null;
  const gl = lienzo?.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!lienzo || !gl) return;
  if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) return;

  const raiz = document.documentElement;
  const tactil = matchMedia('(hover: none), (pointer: coarse)').matches;
  const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // En táctil el scroll corre fuera del hilo principal y el vidrio se desfasaría: ahí se usa vidrio de CSS
  let ligero = tactil;
  if (!tactil) raiz.classList.add('gl-completo');

  const compilar = (fuente: string, tipo: number) => {
    const s = gl.createShader(tipo)!;
    gl.shaderSource(s, fuente);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const programa = (frag: string) => {
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compilar(VERTICES, gl.VERTEX_SHADER));
    gl.attachShader(prog, compilar(frag, gl.FRAGMENT_SHADER));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'programa');
    return prog;
  };
  const uniformes = (prog: WebGLProgram, nombres: string[]) =>
    Object.fromEntries(nombres.map((n) => [n, gl.getUniformLocation(prog, n)]));

  const pAltura = programa(ALTURA);
  const pVidrio = programa(VIDRIO);
  const uAlt = uniformes(pAltura, ['uTam', 'uEscala', 'uTiempo', 'uScroll']);
  const uVid = uniformes(pVidrio, ['uTam', 'uDpr', 'uScroll', 'uTextoA', 'uTextoAlto', 'uRaton', 'uTono', 'uAltura', 'uTexto', 'uN', 'uNG', 'uP', 'uR', 'uG']);

  gl.bindVertexArray(gl.createVertexArray());

  const configurar = () => {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  const texAltura = gl.createTexture();
  const fbo = gl.createFramebuffer();
  const texTexto = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, texTexto);
  configurar();
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texAltura);
  configurar();

  let dpr = Math.min(devicePixelRatio || 1, 1.25);
  let ancho = 0;
  let alto = 0;
  let altoAltura = 0;
  let anchoAltura = 0;
  let textoAlto = 1;
  let ultimaAltura = -Infinity;
  let scrollAltura = -1;

  const dimensionar = () => {
    ancho = lienzo.clientWidth;
    alto = lienzo.clientHeight;
    lienzo.width = Math.round(ancho * dpr);
    lienzo.height = Math.round(alto * dpr);
    anchoAltura = Math.max(Math.round(ancho * ESCALA_ALTURA), 1);
    altoAltura = Math.max(Math.round(alto * ESCALA_ALTURA), 1);
    gl.bindTexture(gl.TEXTURE_2D, texAltura);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, anchoAltura, altoAltura, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texAltura, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('textura de altura');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    ultimaAltura = -Infinity;
  };

  // El nombre se pinta dentro de una textura para que las burbujas también lo deformen.
  // El h1 sigue en el HTML (transparente), así que se puede leer, seleccionar e indexar.
  const pintarNombre = () => {
    if (ligero) return;
    const h = document.querySelector('.heroe') as HTMLElement;
    const escala = Math.min(devicePixelRatio || 1, 2);
    textoAlto = h.offsetHeight;
    const c = document.createElement('canvas');
    c.width = Math.round(ancho * escala);
    c.height = Math.round(textoAlto * escala);
    const ctx = c.getContext('2d')!;
    ctx.scale(escala, escala);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'alphabetic';
    document.querySelectorAll<HTMLElement>('.linea').forEach((l) => {
      const est = getComputedStyle(l);
      const r = l.getBoundingClientRect();
      ctx.font = `${est.fontWeight} ${est.fontSize} ${est.fontFamily}`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = est.letterSpacing;
      const m = ctx.measureText('Jg');
      const asc = m.fontBoundingBoxAscent;
      const des = m.fontBoundingBoxDescent;
      const y = r.top + scrollY + (r.height - (asc + des)) / 2 + asc;
      ctx.fillText(l.textContent ?? '', r.left, y);
    });
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texTexto);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.activeTexture(gl.TEXTURE0);
  };

  // Las medidas se guardan y solo se repiten cuando cambia el tamaño de algo: leerlas en cada cuadro es caro
  type Panel = {
    el: HTMLElement;
    fijo: boolean;
    g: number;
    x: number;
    y: number;
    an: number;
    al: number;
    radio: number;
  };
  const paneles: Panel[] = [...document.querySelectorAll<HTMLElement>('[data-glass]')].map((el) => ({
    el,
    fijo: 'fijo' in el.dataset,
    g: reducido || 'fijo' in el.dataset ? 1 : 0,
    x: 0,
    y: 0,
    an: 0,
    al: 0,
    radio: 0,
  }));
  const secciones = [...document.querySelectorAll<HTMLElement>('[data-animo]')].map((el) => ({
    arriba: 0,
    abajo: 0,
    animo: parseFloat(el.dataset.animo!),
    el,
  }));
  let centroNombre = 0;
  let medidasViejas = true;
  let ultimaActividad = 0;

  const medir = () => {
    medidasViejas = false;
    const s = scrollY;
    for (const p of paneles) {
      const r = p.el.getBoundingClientRect();
      p.x = r.left + r.width / 2;
      p.y = r.top + r.height / 2 + (p.fijo ? 0 : s);
      p.an = r.width / 2;
      p.al = r.height / 2;
      p.radio = parseFloat(p.el.dataset.radio ?? '') || parseFloat(getComputedStyle(p.el).borderRadius) || 20;
    }
    for (const sec of secciones) {
      const r = sec.el.getBoundingClientRect();
      sec.arriba = r.top + s;
      sec.abajo = r.bottom + s;
    }
    const nombre = document.querySelector('.nombre')!.getBoundingClientRect();
    centroNombre = nombre.top + nombre.height / 2 + s;
  };
  const vigilante = new ResizeObserver(() => {
    medidasViejas = true;
    ultimaActividad = performance.now();
  });
  vigilante.observe(document.body);
  paneles.forEach((p) => vigilante.observe(p.el));

  let animo = 0.45;
  let textoA = 0;

  const raton = { x: -999, y: -999, gx: -999, gy: -999, cx: -999, cy: -999, r: 0, objetivoR: 0, colina: 0 };
  addEventListener('scroll', () => (ultimaActividad = performance.now()), { passive: true });
  if (!tactil) {
    addEventListener('pointermove', (e) => {
      ultimaActividad = performance.now();
      if (raton.objetivoR === 0) {
        raton.gx = raton.cx = e.clientX;
        raton.gy = raton.cy = e.clientY;
      }
      raton.x = e.clientX;
      raton.y = e.clientY;
      const sobre = (e.target as Element).closest?.('a, button, label');
      raton.objetivoR = sobre ? 18 : 12;
    }, { passive: true });
    raiz.addEventListener('pointerleave', () => (raton.objetivoR = 0));
  }

  const datosP = new Float32Array(MAX_PANELES * 4);
  const datosR = new Float32Array(MAX_PANELES);
  const datosG = new Float32Array(MAX_GOTAS * 3);

  const inicio = performance.now();
  let ultimoCuadro = inicio;
  let lentos = 0;
  let cuadros = 0;
  let nivel = 0;
  let topeSiempre = false;

  // Si el equipo no alcanza, se baja la calidad por escalones antes que perder fluidez
  const bajarCalidad = () => {
    nivel++;
    lentos = 0;
    cuadros = 0;
    if (nivel === 1 && dpr > 1) {
      dpr = 1;
      dimensionar();
    } else if (nivel <= 2 && !ligero) {
      nivel = 2;
      dpr = Math.min(dpr, 0.75);
      ligero = true;
      raiz.classList.remove('gl-completo');
      raiz.classList.add('gl-ligero');
      dimensionar();
    } else {
      topeSiempre = true;
    }
  };

  const cuadro = (ahora: number) => {
    requestAnimationFrame(cuadro);

    // Sin scroll ni cursor el fondo se mueve tan lento que 30 cuadros por segundo bastan
    const animandoPanel = paneles.some((p) => p.g < 1 && (p.fijo || p.el.classList.contains('dentro')));
    const animandoCursor =
      Math.abs(raton.x - raton.gx) + Math.abs(raton.y - raton.gy) > 0.3 || Math.abs(raton.objetivoR - raton.r) > 0.2;
    const reposo = ahora - ultimaActividad > 250 && !animandoPanel && !animandoCursor;
    if ((reposo || topeSiempre) && ahora - ultimoCuadro < INTERVALO_REPOSO) return;

    const paso = ahora - ultimoCuadro;
    ultimoCuadro = ahora;
    const suavizar = (factor: number) => 1 - Math.pow(1 - factor, paso / 16.67);

    if (++cuadros > 30 && paso < 400 && !topeSiempre) {
      lentos = paso > (reposo ? 52 : 28) ? lentos + 1 : Math.max(lentos - 1, 0);
      if (lentos > 40) bajarCalidad();
    }

    if (medidasViejas) medir();
    const t = reducido ? 40 : (ahora - inicio) / 1000;
    const scroll = scrollY;

    const centro = scroll + alto / 2;
    // Gana el último que contiene el centro: un panel con ánimo propio manda sobre su sección
    let animoObjetivo = animo;
    for (const s of secciones) {
      if (s.arriba < centro && s.abajo > centro) animoObjetivo = s.animo;
    }
    animo += (animoObjetivo - animo) * suavizar(0.03);
    textoA += ((ligero ? 0 : 1) - textoA) * (reducido ? 1 : suavizar(0.05));

    // La gota va casi pegada al cursor y sin rebote; el relieve lo sigue más despacio, sin sumar retraso visible
    const seguir = suavizar(0.6);
    raton.gx += (raton.x - raton.gx) * seguir;
    raton.gy += (raton.y - raton.gy) * seguir;
    const seguirColina = suavizar(0.12);
    raton.cx += (raton.x - raton.cx) * seguirColina;
    raton.cy += (raton.y - raton.cy) * seguirColina;
    raton.r += (raton.objetivoR - raton.r) * suavizar(0.12);
    raton.colina += ((raton.objetivoR > 0 ? 1 : 0) - raton.colina) * suavizar(0.04);

    let n = 0;
    if (!ligero) {
      for (const p of paneles) {
        if (!p.fijo && !p.el.classList.contains('dentro')) continue;
        if (p.g < 1) {
          p.g += (1 - p.g) * suavizar(0.1);
          if (1 - p.g < 0.002) p.g = 1;
        }
        const y = p.fijo ? p.y : p.y - scroll;
        if (y + p.al < -40 || y - p.al > alto + 40 || n >= MAX_PANELES) continue;
        const mx = p.an * (0.97 + 0.03 * p.g);
        const my = Math.max(p.al * p.g, 0.01);
        datosP.set([p.x, y, mx, my], n * 4);
        datosR[n] = Math.min(p.radio, mx, my);
        n++;
      }
    }

    // Burbujas sobre el nombre (solo mientras el héroe está a la vista) y la gota del cursor
    let ng = 0;
    if (raton.r >= 0.5) {
      datosG.set([raton.gx, raton.gy, raton.r], 0);
      ng = 1;
    }
    if (scroll < alto * 1.2) {
      const u = Math.min(ancho, alto * 1.7);
      const baseY = centroNombre - scroll;
      datosG.set([
        ancho * (0.58 + 0.24 * Math.sin(t * 0.17)), baseY + alto * 0.14 * Math.sin(t * 0.23 + 1), u * 0.085,
        ancho * (0.77 + 0.14 * Math.sin(t * 0.21 + 2)), baseY + alto * 0.18 * Math.cos(t * 0.19), u * 0.055,
        ancho * (0.3 + 0.18 * Math.cos(t * 0.13)), baseY + alto * 0.1 * Math.sin(t * 0.27 + 4), u * 0.04,
      ], ng * 3);
      ng += 3;
    }

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texTexto);
    gl.activeTexture(gl.TEXTURE0);

    // El terreno solo se recalcula si pasó su intervalo o si cambió el scroll
    if (scroll !== scrollAltura || ahora - ultimaAltura >= INTERVALO_ALTURA) {
      ultimaAltura = ahora;
      scrollAltura = scroll;
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, anchoAltura, altoAltura);
      gl.useProgram(pAltura);
      gl.uniform2f(uAlt.uTam, ancho, alto);
      gl.uniform1f(uAlt.uEscala, anchoAltura / ancho);
      gl.uniform1f(uAlt.uTiempo, t);
      gl.uniform1f(uAlt.uScroll, scroll);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    gl.bindTexture(gl.TEXTURE_2D, texAltura);
    gl.viewport(0, 0, lienzo.width, lienzo.height);
    gl.useProgram(pVidrio);
    gl.uniform2f(uVid.uTam, ancho, alto);
    gl.uniform1f(uVid.uDpr, dpr);
    gl.uniform1f(uVid.uScroll, scroll);
    gl.uniform1f(uVid.uTextoA, scroll < textoAlto && textoA > 0.002 ? textoA : 0);
    gl.uniform1f(uVid.uTextoAlto, textoAlto);
    gl.uniform3f(uVid.uRaton, raton.cx, raton.cy, raton.colina);
    gl.uniform3f(
      uVid.uTono,
      TONO_FRIO[0] + (TONO_CALIDO[0] - TONO_FRIO[0]) * animo,
      TONO_FRIO[1] + (TONO_CALIDO[1] - TONO_FRIO[1]) * animo,
      TONO_FRIO[2] + (TONO_CALIDO[2] - TONO_FRIO[2]) * animo,
    );
    gl.uniform1i(uVid.uAltura, 0);
    gl.uniform1i(uVid.uTexto, 1);
    gl.uniform1i(uVid.uN, n);
    gl.uniform1i(uVid.uNG, ng);
    gl.uniform4fv(uVid.uP, datosP);
    gl.uniform1fv(uVid.uR, datosR);
    gl.uniform3fv(uVid.uG, datosG);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  dimensionar();
  medir();
  pintarNombre();
  document.fonts.ready.then(() => {
    medidasViejas = true;
    pintarNombre();
  });
  let espera: ReturnType<typeof setTimeout>;
  addEventListener('resize', () => {
    clearTimeout(espera);
    espera = setTimeout(() => {
      dimensionar();
      medidasViejas = true;
      pintarNombre();
    }, 120);
  });
  requestAnimationFrame(cuadro);
}

try {
  iniciar();
} catch (error) {
  // Sin vidrio WebGL la página sigue completa, con el vidrio de CSS
  document.documentElement.classList.remove('gl-completo');
  console.warn(error);
}
