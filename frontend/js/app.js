// ===== SubastasGT: SPA con Firebase (Auth + Firestore en tiempo real) =====
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, updateProfile
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, addDoc, setDoc, getDoc, getDocs, updateDoc,
  onSnapshot, query, where, orderBy, runTransaction, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ===== Estado global =====
let usuario = null;          // usuario de Firebase Auth
let perfil = null;           // datos de /usuarios/{uid}
let listeners = [];          // suscripciones en tiempo real activas
let intervalos = [];         // relojes activos
let autenticacionLista = false;

const $ = s => document.querySelector(s);
const vista = () => $('#app');

// ===== Utilidades =====
function esc(t) { const d = document.createElement('div'); d.textContent = t ?? ''; return d.innerHTML; }
function fmtQ(n) { return 'Q ' + Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function mensaje(tipo, texto) {
  $('#mensajes').innerHTML = `<div class="alert alert-${tipo} alert-dismissible fade show">${esc(texto)}
    <button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function limpiarMensaje() { $('#mensajes').innerHTML = ''; }
function limpiar() {
  listeners.forEach(u => u()); listeners = [];
  intervalos.forEach(i => clearInterval(i)); intervalos = [];
}
function restante(ms) {
  if (ms <= 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  const p = n => String(n).padStart(2, '0');
  return (d ? d + 'd ' : '') + `${p(h)}:${p(m)}:${p(x)}`;
}
const DANO = {
  verde: { texto: 'Verde: daño menor / limpio', clase: 'dano-verde', punto: 'punto-verde' },
  amarillo: { texto: 'Amarillo: daño medio / reparable', clase: 'dano-amarillo', punto: 'punto-amarillo' },
  rojo: { texto: 'Rojo: daño severo / salvamento', clase: 'dano-rojo', punto: 'punto-rojo' }
};
function badgeDano(d) { const x = DANO[d] || DANO.verde; return `<span class="dano ${x.clase}"><span class="punto ${x.punto}"></span>${x.texto}</span>`; }

// Estado de la subasta según la hora actual
function estadoSubasta(v, ahora = Date.now()) {
  const ini = v.fechaInicio.toMillis(), fin = v.fechaCierre.toMillis();
  if (ahora < ini) return { codigo: 'proxima', texto: 'Próximamente', clase: 'bg-info text-dark', ms: ini - ahora, etiqueta: 'Inicia en' };
  if (ahora < fin) return { codigo: 'activa', texto: 'Subasta activa', clase: 'bg-success', ms: fin - ahora, etiqueta: 'Cierra en' };
  if ((v.totalPujas || 0) > 0) return { codigo: 'vendida', texto: 'Oferta cerrada - Vendida', clase: 'bg-secondary', ms: 0, etiqueta: 'Finalizada' };
  return { codigo: 'desierta', texto: 'Oferta cerrada - No vendida / Desierta', clase: 'bg-danger', ms: 0, etiqueta: 'Finalizada' };
}
// Mínimo de la siguiente puja: base si no hay ofertas; si hay, +10% de la actual (enteros)
function minimoSiguiente(v) {
  if (!v.ofertaActual) return v.montoBase;
  return Math.max(v.montoBase, Math.ceil(v.ofertaActual * 11 / 10));
}

// Comprimir imagen en el navegador y devolverla como dataURL JPEG
function comprimir(file, max, calidad) {
  return new Promise((res, rej) => {
    const lector = new FileReader();
    lector.onload = () => {
      const img = new Image();
      img.onload = () => {
        const escala = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', calidad));
      };
      img.onerror = rej; img.src = lector.result;
    };
    lector.onerror = rej; lector.readAsDataURL(file);
  });
}

// ===== Navegación =====
function pintarNav() {
  $('#navIzq').innerHTML = `
    <li class="nav-item"><a class="nav-link" href="#/"><i class="fa-solid fa-car"></i> Inventario</a></li>
    ${usuario ? `
    <li class="nav-item"><a class="nav-link" href="#/publicar"><i class="fa-solid fa-plus"></i> Publicar vehículo</a></li>
    <li class="nav-item"><a class="nav-link" href="#/mis"><i class="fa-solid fa-list"></i> Mis publicaciones</a></li>` : ''}`;
  $('#navDer').innerHTML = usuario ? `
    <li class="nav-item"><span class="nav-link"><i class="fa-solid fa-user"></i> ${esc(perfil?.nombre || usuario.email)}</span></li>
    <li class="nav-item"><a class="nav-link" href="#" id="btnSalir"><i class="fa-solid fa-right-from-bracket"></i> Salir</a></li>` : `
    <li class="nav-item"><a class="nav-link" href="#/login">Iniciar sesión</a></li>
    <li class="nav-item"><a class="nav-link" href="#/registro">Registrarse</a></li>`;
  const salir = $('#btnSalir');
  if (salir) salir.onclick = async e => { e.preventDefault(); await signOut(auth); location.hash = '#/'; };
}

const rutas = {
  '': vistaInventario, 'login': vistaLogin, 'registro': vistaRegistro,
  'publicar': vistaPublicar, 'mis': vistaMis, 'editar': vistaEditar, 'vehiculo': vistaDetalle
};
const protegidas = ['publicar', 'mis', 'editar'];

function router() {
  if (!autenticacionLista) return;
  limpiar();
  const [ruta = '', id] = location.hash.replace(/^#\/?/, '').split('/');
  if (protegidas.includes(ruta) && !usuario) {
    mensaje('warning', 'Debés iniciar sesión para publicar u ofertar.');
    location.hash = '#/login'; return;
  }
  (rutas[ruta] || vistaInventario)(id);
}
window.addEventListener('hashchange', () => { limpiarMensaje(); router(); });

onAuthStateChanged(auth, async u => {
  usuario = u;
  perfil = null;
  if (u) {
    try { const s = await getDoc(doc(db, 'usuarios', u.uid)); perfil = s.exists() ? s.data() : null; } catch (_) {}
  }
  autenticacionLista = true;
  pintarNav();
  router();
});

// ===== Vista: Inventario (Home) con filtros =====
function vistaInventario() {
  vista().innerHTML = `
    <div class="tarjeta mb-4">
      <h2 class="titulo-seccion mb-3"><i class="fa-solid fa-magnifying-glass"></i> Inventario de subastas</h2>
      <div class="row g-2">
        <div class="col-md-4"><input id="fTexto" class="form-control" placeholder="Buscar marca, modelo, motor..."></div>
        <div class="col-6 col-md-2"><select id="fAnio" class="form-select"><option value="">Año</option></select></div>
        <div class="col-6 col-md-2"><select id="fMarca" class="form-select"><option value="">Marca</option></select></div>
        <div class="col-6 col-md-2"><select id="fModelo" class="form-select"><option value="">Modelo</option></select></div>
        <div class="col-6 col-md-2"><select id="fDano" class="form-select"><option value="">Daño</option>
          <option value="verde">Verde</option><option value="amarillo">Amarillo</option><option value="rojo">Rojo</option></select></div>
        <div class="col-6 col-md-2"><select id="fCombustible" class="form-select"><option value="">Combustible</option></select></div>
        <div class="col-6 col-md-2"><select id="fTransmision" class="form-select"><option value="">Transmisión</option></select></div>
        <div class="col-6 col-md-2"><select id="fTren" class="form-select"><option value="">Tren de manejo</option></select></div>
        <div class="col-6 col-md-2"><select id="fTipo" class="form-select"><option value="">Tipo</option></select></div>
        <div class="col-6 col-md-2"><select id="fEstado" class="form-select"><option value="">Estado</option>
          <option value="activa">Activas</option><option value="proxima">Próximas</option><option value="cerrada">Cerradas</option></select></div>
        <div class="col-6 col-md-2"><button id="fLimpiar" class="btn btn-outline-primary w-100">Limpiar</button></div>
      </div>
      ${usuario ? '' : '<p class="text-muted mt-3 mb-0"><i class="fa-solid fa-lock"></i> Estás en modo lectura. <a href="#/login">Iniciá sesión</a> para ofertar o publicar.</p>'}
    </div>
    <div class="row g-3" id="grid"><div class="text-center py-5"><div class="spinner-border text-primary"></div></div></div>`;

  let vehiculos = [];
  const filtros = ['fTexto', 'fAnio', 'fMarca', 'fModelo', 'fDano', 'fCombustible', 'fTransmision', 'fTren', 'fTipo', 'fEstado'];
  const llenar = (id, campo) => {
    const sel = $('#' + id), actual = sel.value;
    const valores = [...new Set(vehiculos.map(v => v[campo]).filter(Boolean))].sort();
    sel.innerHTML = sel.options[0].outerHTML + valores.map(x => `<option ${String(x) === actual ? 'selected' : ''}>${esc(x)}</option>`).join('');
  };
  const pintar = () => {
    const f = Object.fromEntries(filtros.map(id => [id, $('#' + id).value]));
    const t = f.fTexto.trim().toLowerCase();
    const lista = vehiculos.filter(v => {
      const e = estadoSubasta(v).codigo;
      return (!t || [v.marca, v.modelo, v.motor, v.tipoArticulo].join(' ').toLowerCase().includes(t))
        && (!f.fAnio || String(v.anio) === f.fAnio) && (!f.fMarca || v.marca === f.fMarca)
        && (!f.fModelo || v.modelo === f.fModelo) && (!f.fDano || v.dano === f.fDano)
        && (!f.fCombustible || v.combustible === f.fCombustible) && (!f.fTransmision || v.transmision === f.fTransmision)
        && (!f.fTren || v.tren === f.fTren) && (!f.fTipo || v.tipoArticulo === f.fTipo)
        && (!f.fEstado || (f.fEstado === 'cerrada' ? ['vendida', 'desierta'].includes(e) : e === f.fEstado));
    });
    $('#grid').innerHTML = lista.length ? lista.map(v => {
      const e = estadoSubasta(v);
      return `<div class="col-sm-6 col-lg-4">
        <a class="card-vehiculo" href="#/vehiculo/${v.id}">
          <img src="${v.portada}" alt="${esc(v.marca)} ${esc(v.modelo)}">
          <div class="cuerpo">
            <div class="d-flex justify-content-between align-items-start mb-1">
              <h5 class="mb-0">${esc(v.anio)} ${esc(v.marca)} ${esc(v.modelo)}</h5>
              <span class="badge ${e.clase}">${e.texto.split(' - ')[0]}</span>
            </div>
            <p class="text-muted small mb-2">${esc(v.tipoArticulo)} · ${esc(v.motor)} · ${esc(v.transmision)} · ${esc(v.combustible)} · ${esc(v.tren)}</p>
            ${badgeDano(v.dano)}
            <div class="d-flex justify-content-between align-items-end mt-3">
              <div><small class="text-muted">${v.ofertaActual ? 'Oferta actual' : 'Precio base'}</small>
                <div class="oferta">${fmtQ(v.ofertaActual || v.montoBase)}</div></div>
              <div class="text-end"><small class="text-muted">${e.etiqueta}</small>
                <div class="reloj" data-id="${v.id}">${restante(e.ms)}</div></div>
            </div>
          </div>
        </a></div>`;
    }).join('') : '<p class="text-center text-muted py-5">No hay vehículos que coincidan con los filtros.</p>';
  };

  filtros.forEach(id => $('#' + id).addEventListener(id === 'fTexto' ? 'input' : 'change', pintar));
  $('#fLimpiar').onclick = () => { filtros.forEach(id => $('#' + id).value = ''); pintar(); };

  // Tiempo real: el inventario se actualiza solo cuando hay pujas o publicaciones nuevas
  listeners.push(onSnapshot(query(collection(db, 'vehiculos'), orderBy('creado', 'desc')), snap => {
    vehiculos = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(v => v.fechaInicio && v.fechaCierre);
    llenar('fAnio', 'anio'); llenar('fMarca', 'marca'); llenar('fModelo', 'modelo'); llenar('fCombustible', 'combustible');
    llenar('fTransmision', 'transmision'); llenar('fTren', 'tren'); llenar('fTipo', 'tipoArticulo');
    pintar();
  }, err => mensaje('danger', 'Error al cargar el inventario: ' + err.message)));

  // Relojes de las tarjetas
  intervalos.push(setInterval(() => {
    document.querySelectorAll('.reloj[data-id]').forEach(el => {
      const v = vehiculos.find(x => x.id === el.dataset.id);
      if (v) el.textContent = restante(estadoSubasta(v).ms);
    });
  }, 1000));
}

// ===== Vista: Login =====
function vistaLogin() {
  if (usuario) { location.hash = '#/'; return; }
  vista().innerHTML = `
    <div class="row justify-content-center"><div class="col-md-5"><div class="tarjeta">
      <h2 class="titulo-seccion mb-3">Iniciar sesión</h2>
      <form id="form">
        <div class="mb-3"><label class="form-label">Correo electrónico</label><input type="email" name="correo" class="form-control" required></div>
        <div class="mb-3"><label class="form-label">Contraseña</label><input type="password" name="pass" class="form-control" required></div>
        <button class="btn btn-primary w-100">Ingresar</button>
      </form>
      <p class="mt-3 mb-0 text-center">¿No tenés cuenta? <a href="#/registro">Registrate</a></p>
    </div></div></div>`;
  $('#form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await signInWithEmailAndPassword(auth, f.get('correo').trim(), f.get('pass'));
      limpiarMensaje(); location.hash = '#/';
    } catch (_) { mensaje('danger', 'Correo o contraseña incorrectos.'); }
  };
}

// ===== Vista: Registro =====
function vistaRegistro() {
  if (usuario) { location.hash = '#/'; return; }
  vista().innerHTML = `
    <div class="row justify-content-center"><div class="col-md-7"><div class="tarjeta">
      <h2 class="titulo-seccion mb-3">Crear cuenta</h2>
      <form id="form" class="row g-3">
        <div class="col-md-6"><label class="form-label">Nombre</label><input name="nombre" class="form-control" required></div>
        <div class="col-md-6"><label class="form-label">Apellido</label><input name="apellido" class="form-control" required></div>
        <div class="col-md-6"><label class="form-label">Correo electrónico</label><input type="email" name="correo" class="form-control" required></div>
        <div class="col-md-6"><label class="form-label">Teléfono</label><input name="telefono" class="form-control" pattern="[0-9]{8}" title="8 dígitos" required></div>
        <div class="col-md-6"><label class="form-label">Contraseña segura</label><input type="password" name="pass" class="form-control" required></div>
        <div class="col-md-6"><label class="form-label">Confirmar contraseña</label><input type="password" name="pass2" class="form-control" required></div>
        <div class="col-12"><small class="text-muted">Mínimo 8 caracteres, con mayúscula, minúscula, número y símbolo.</small></div>
        <div class="col-12"><button class="btn btn-primary w-100">Registrarme</button></div>
      </form>
    </div></div></div>`;
  $('#form').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{8,}$/.test(f.pass)) return mensaje('warning', 'La contraseña no es segura: mínimo 8 caracteres con mayúscula, minúscula, número y símbolo.');
    if (f.pass !== f.pass2) return mensaje('warning', 'Las contraseñas no coinciden.');
    try {
      const cred = await createUserWithEmailAndPassword(auth, f.correo.trim(), f.pass);
      perfil = { nombre: f.nombre.trim(), apellido: f.apellido.trim(), correo: f.correo.trim(), telefono: f.telefono.trim(), creado: serverTimestamp() };
      await setDoc(doc(db, 'usuarios', cred.user.uid), perfil);
      await updateProfile(cred.user, { displayName: `${perfil.nombre} ${perfil.apellido}` });
      pintarNav(); mensaje('success', '¡Cuenta creada! Ya podés publicar y ofertar.'); location.hash = '#/';
    } catch (err) {
      mensaje('danger', err.code === 'auth/email-already-in-use' ? 'Ese correo ya está registrado.' : 'No se pudo registrar: ' + err.message);
    }
  };
}

// ===== Formulario de vehículo (publicar y editar) =====
function formVehiculo(v = {}, editando = false) {
  const opt = (lista, sel) => lista.map(x => `<option ${x === sel ? 'selected' : ''}>${x}</option>`).join('');
  const aLocal = ts => { if (!ts) return ''; const d = ts.toDate(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  return `
  <form id="form" class="row g-3">
    <h5 class="titulo-seccion mt-2">Ficha técnica</h5>
    <div class="col-md-3"><label class="form-label">Año</label><input type="number" name="anio" min="1950" max="2027" class="form-control" value="${esc(v.anio)}" required></div>
    <div class="col-md-3"><label class="form-label">Tipo de artículo</label><select name="tipoArticulo" class="form-select" required>${opt(['Automóvil', 'SUV', 'Pickup', 'Camión', 'Motocicleta', 'Otro'], v.tipoArticulo)}</select></div>
    <div class="col-md-3"><label class="form-label">Marca</label><input name="marca" class="form-control" value="${esc(v.marca)}" required></div>
    <div class="col-md-3"><label class="form-label">Modelo</label><input name="modelo" class="form-control" value="${esc(v.modelo)}" required></div>
    <div class="col-md-3"><label class="form-label">Motor</label><input name="motor" class="form-control" placeholder="Ej. 2.0L" value="${esc(v.motor)}" required></div>
    <div class="col-md-3"><label class="form-label">Transmisión</label><select name="transmision" class="form-select" required>${opt(['Automática', 'Manual', 'CVT'], v.transmision)}</select></div>
    <div class="col-md-3"><label class="form-label">Combustible</label><select name="combustible" class="form-select" required>${opt(['Gasolina', 'Diésel', 'Híbrido', 'Eléctrico'], v.combustible)}</select></div>
    <div class="col-md-3"><label class="form-label">Tren de manejo</label><select name="tren" class="form-select" required>${opt(['FWD', 'RWD', 'AWD', '4WD'], v.tren)}</select></div>
    <div class="col-md-3"><label class="form-label">Número de cilindros</label><input type="number" name="cilindros" min="1" max="16" class="form-control" value="${esc(v.cilindros)}" required></div>
    <div class="col-md-9"><label class="form-label d-block">Estado de daño</label>
      ${['verde', 'amarillo', 'rojo'].map(d => `<div class="form-check form-check-inline">
        <input class="form-check-input" type="radio" name="dano" value="${d}" id="d_${d}" ${(v.dano || 'verde') === d ? 'checked' : ''}>
        <label class="form-check-label" for="d_${d}">${badgeDano(d)}</label></div>`).join('')}
    </div>
    ${editando ? '' : `
    <h5 class="titulo-seccion mt-4">Galería fotográfica</h5>
    <div class="col-12"><input type="file" name="fotos" id="fotos" accept="image/*" multiple class="form-control" required>
      <small class="text-muted">Mínimo 5 fotografías. La primera será la portada.</small><div id="previa" class="previa mt-2"></div></div>`}
    <h5 class="titulo-seccion mt-4">Parámetros de la subasta</h5>
    <div class="col-md-4"><label class="form-label">Precio / monto base (Q)</label><input type="number" name="montoBase" min="1" step="1" class="form-control" value="${esc(v.montoBase)}" required></div>
    <div class="col-md-4"><label class="form-label">Fecha y hora de inicio</label><input type="datetime-local" name="fechaInicio" class="form-control" value="${aLocal(v.fechaInicio)}" required></div>
    <div class="col-md-4"><label class="form-label">Fecha y hora de cierre</label><input type="datetime-local" name="fechaCierre" class="form-control" value="${aLocal(v.fechaCierre)}" required></div>
    <div class="col-12"><button id="btnGuardar" class="btn btn-amarillo btn-lg w-100">${editando ? 'Guardar cambios' : 'Publicar vehículo'}</button></div>
  </form>`;
}
function leerFicha(f) {
  return {
    anio: parseInt(f.get('anio')), tipoArticulo: f.get('tipoArticulo'), marca: f.get('marca').trim(),
    modelo: f.get('modelo').trim(), motor: f.get('motor').trim(), transmision: f.get('transmision'),
    combustible: f.get('combustible'), tren: f.get('tren'), cilindros: parseInt(f.get('cilindros')),
    dano: f.get('dano'), montoBase: parseInt(f.get('montoBase')),
    fechaInicio: Timestamp.fromDate(new Date(f.get('fechaInicio'))),
    fechaCierre: Timestamp.fromDate(new Date(f.get('fechaCierre')))
  };
}

// ===== Vista: Publicar =====
function vistaPublicar() {
  vista().innerHTML = `<div class="tarjeta"><h2 class="titulo-seccion">Publicar vehículo para subasta</h2>${formVehiculo()}</div>`;
  $('#fotos').onchange = e => {
    $('#previa').innerHTML = [...e.target.files].map(f => `<img src="${URL.createObjectURL(f)}">`).join('');
  };
  $('#form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const datos = leerFicha(f);
    const archivos = [...$('#fotos').files];
    if (archivos.length < 5) return mensaje('warning', 'Debés subir mínimo 5 fotografías.');
    if (datos.fechaCierre.toMillis() <= datos.fechaInicio.toMillis()) return mensaje('warning', 'La fecha de cierre debe ser posterior a la de inicio.');
    if (datos.fechaCierre.toMillis() <= Date.now()) return mensaje('warning', 'La fecha de cierre debe ser futura.');
    const btn = $('#btnGuardar'); btn.disabled = true; btn.textContent = 'Publicando...';
    try {
      const portada = await comprimir(archivos[0], 500, 0.6);
      const ref = await addDoc(collection(db, 'vehiculos'), {
        ...datos, portada, ownerId: usuario.uid, ofertaActual: 0, ganadorId: null, totalPujas: 0, creado: serverTimestamp()
      });
      for (let i = 0; i < archivos.length; i++) {
        const data = await comprimir(archivos[i], 1024, 0.6);
        await addDoc(collection(db, 'vehiculos', ref.id, 'fotos'), { data, orden: i });
      }
      mensaje('success', 'Vehículo publicado correctamente.');
      location.hash = '#/vehiculo/' + ref.id;
    } catch (err) {
      mensaje('danger', 'No se pudo publicar: ' + err.message);
      btn.disabled = false; btn.textContent = 'Publicar vehículo';
    }
  };
}

// ===== Vista: Mis publicaciones (buscar y editar) =====
async function vistaMis() {
  vista().innerHTML = `<div class="tarjeta">
    <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
      <h2 class="titulo-seccion mb-0">Mis publicaciones</h2>
      <input id="buscar" class="form-control" style="max-width:320px" placeholder="Buscar por marca, modelo o año...">
    </div><div id="lista"><div class="spinner-border text-primary"></div></div></div>`;
  const snap = await getDocs(query(collection(db, 'vehiculos'), where('ownerId', '==', usuario.uid)));
  const mios = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const pintar = () => {
    const t = $('#buscar').value.trim().toLowerCase();
    const lista = mios.filter(v => `${v.marca} ${v.modelo} ${v.anio}`.toLowerCase().includes(t));
    $('#lista').innerHTML = lista.length ? `<div class="table-responsive"><table class="table align-middle">
      <thead><tr><th></th><th>Vehículo</th><th>Base</th><th>Oferta actual</th><th>Estado</th><th></th></tr></thead><tbody>
      ${lista.map(v => { const e = estadoSubasta(v); return `<tr>
        <td><img src="${v.portada}" width="80" class="rounded"></td>
        <td>${esc(v.anio)} ${esc(v.marca)} ${esc(v.modelo)}<br>${badgeDano(v.dano)}</td>
        <td>${fmtQ(v.montoBase)}</td><td>${v.ofertaActual ? fmtQ(v.ofertaActual) : '—'}</td>
        <td><span class="badge ${e.clase}">${e.texto}</span></td>
        <td class="text-nowrap"><a href="#/vehiculo/${v.id}" class="btn btn-sm btn-outline-primary">Ver</a>
          <a href="#/editar/${v.id}" class="btn btn-sm btn-primary">Editar</a></td></tr>`; }).join('')}
      </tbody></table></div>` : '<p class="text-muted">No tenés publicaciones que coincidan.</p>';
  };
  $('#buscar').oninput = pintar; pintar();
}

// ===== Vista: Editar =====
async function vistaEditar(id) {
  const snap = await getDoc(doc(db, 'vehiculos', id));
  if (!snap.exists() || snap.data().ownerId !== usuario.uid) { mensaje('danger', 'No podés editar esta publicación.'); location.hash = '#/mis'; return; }
  const v = snap.data();
  vista().innerHTML = `<div class="tarjeta"><h2 class="titulo-seccion">Editar publicación</h2>${formVehiculo(v, true)}</div>`;
  $('#form').onsubmit = async e => {
    e.preventDefault();
    const datos = leerFicha(new FormData(e.target));
    if (datos.fechaCierre.toMillis() <= datos.fechaInicio.toMillis()) return mensaje('warning', 'La fecha de cierre debe ser posterior a la de inicio.');
    if (v.totalPujas > 0 && datos.montoBase !== v.montoBase) return mensaje('warning', 'No se puede cambiar el monto base porque ya hay ofertas.');
    try {
      await updateDoc(doc(db, 'vehiculos', id), datos);
      mensaje('success', 'Publicación actualizada.'); location.hash = '#/vehiculo/' + id;
    } catch (err) { mensaje('danger', 'No se pudo guardar: ' + err.message); }
  };
}

// ===== Vista: Detalle y subasta en tiempo real =====
async function vistaDetalle(id) {
  const ref = doc(db, 'vehiculos', id);
  let v = null, participo = false;

  vista().innerHTML = `
    <a href="#/" class="btn btn-link px-0 mb-2"><i class="fa-solid fa-arrow-left"></i> Volver al inventario</a>
    <div class="row g-4">
      <div class="col-lg-7">
        <div class="tarjeta p-2 mb-4"><div id="carrusel" class="carousel slide">
          <div class="carousel-inner" id="fotos"><div class="text-center py-5"><div class="spinner-border text-primary"></div></div></div>
          <button class="carousel-control-prev" type="button" data-bs-target="#carrusel" data-bs-slide="prev"><span class="carousel-control-prev-icon bg-dark rounded"></span></button>
          <button class="carousel-control-next" type="button" data-bs-target="#carrusel" data-bs-slide="next"><span class="carousel-control-next-icon bg-dark rounded"></span></button>
        </div></div>
        <div class="tarjeta"><h4 class="titulo-seccion">Ficha técnica</h4><table class="table ficha mb-0" id="ficha"></table></div>
      </div>
      <div class="col-lg-5"><div class="tarjeta" id="panel"></div></div>
    </div>`;

  // Galería (se carga una vez)
  getDocs(query(collection(db, 'vehiculos', id, 'fotos'), orderBy('orden'))).then(s => {
    $('#fotos').innerHTML = s.docs.map((d, i) => `<div class="carousel-item ${i === 0 ? 'active' : ''}">
      <img src="${d.data().data}" class="d-block w-100" alt="Foto ${i + 1}"></div>`).join('');
  });

  // ¿Este usuario ya ofertó antes? (para mostrar "Tu oferta ha sido superada")
  if (usuario) {
    const p = await getDoc(doc(db, 'vehiculos', id, 'postores', usuario.uid));
    participo = p.exists();
  }

  const pintarPanel = () => {
    if (!v) return;
    const e = estadoSubasta(v);
    const esDueno = usuario && usuario.uid === v.ownerId;
    const gano = usuario && v.ganadorId === usuario.uid;
    let indicador = '';
    if (usuario && !esDueno) {
      if (gano) indicador = e.codigo === 'vendida'
        ? '<div class="estado-puja alert alert-success">🏆 ¡Ganaste esta subasta!</div>'
        : '<div class="estado-puja alert alert-success"><i class="fa-solid fa-circle-check"></i> ¡Vas ganando esta subasta!</div>';
      else if (participo) indicador = e.codigo === 'activa'
        ? '<div class="estado-puja alert alert-danger"><i class="fa-solid fa-triangle-exclamation"></i> Tu oferta ha sido superada. ¡Hacé tu oferta antes de que termine el tiempo!</div>'
        : '<div class="estado-puja alert alert-secondary">Tu oferta fue superada. La subasta ya cerró.</div>';
    }
    let accion;
    if (e.codigo !== 'activa') accion = `<div class="alert alert-secondary mb-0">${e.codigo === 'proxima' ? 'La subasta aún no ha iniciado.' : '<b>Oferta cerrada.</b> Ya no es posible ofertar.'}</div>`;
    else if (!usuario) accion = '<div class="alert alert-info mb-0"><i class="fa-solid fa-lock"></i> <a href="#/login">Iniciá sesión</a> para ofertar.</div>';
    else if (esDueno) accion = '<div class="alert alert-info mb-0">Sos el publicador de este vehículo; no podés ofertar.</div>';
    else accion = `<form id="formPuja">
        <label class="form-label">Tu oferta (Q)</label>
        <div class="input-group"><span class="input-group-text">Q</span>
          <input type="number" id="monto" class="form-control form-control-lg" min="${minimoSiguiente(v)}" step="1" value="${minimoSiguiente(v)}" required>
          <button class="btn btn-amarillo btn-lg">Ofertar</button></div>
        <small class="text-muted">Oferta mínima: ${fmtQ(minimoSiguiente(v))}${v.ofertaActual ? ' (10% sobre la oferta actual)' : ' (monto base)'}</small>
      </form>`;

    $('#panel').innerHTML = `
      <h3 class="mb-1">${esc(v.anio)} ${esc(v.marca)} ${esc(v.modelo)}</h3>
      <div class="mb-3">${badgeDano(v.dano)} <span class="badge ${e.clase} ms-1">${e.texto}</span></div>
      <div class="row text-center mb-3">
        <div class="col-6"><small class="text-muted">Precio base</small><div class="fw-bold">${fmtQ(v.montoBase)}</div></div>
        <div class="col-6"><small class="text-muted">Pujas</small><div class="fw-bold">${v.totalPujas || 0}</div></div>
      </div>
      <div class="text-center mb-3 p-3 rounded" style="background:var(--azul-claro)">
        <small class="text-muted">Oferta actual más alta</small>
        <div class="oferta" style="font-size:2rem">${v.ofertaActual ? fmtQ(v.ofertaActual) : 'Sin ofertas'}</div>
        <small class="text-muted">${e.etiqueta}</small>
        <div class="reloj reloj-grande" id="reloj">${restante(e.ms)}</div>
      </div>
      ${indicador}${accion}`;

    const fp = $('#formPuja');
    if (fp) fp.onsubmit = ofertar;
  };

  async function ofertar(ev) {
    ev.preventDefault();
    const monto = parseInt($('#monto').value);
    try {
      await runTransaction(db, async tx => {
        const s = await tx.get(ref); const d = s.data(); const ahora = Date.now();
        if (ahora < d.fechaInicio.toMillis()) throw new Error('La subasta aún no inicia.');
        if (ahora >= d.fechaCierre.toMillis()) throw new Error('Oferta cerrada: ya terminó el tiempo.');
        const min = minimoSiguiente(d);
        if (!Number.isInteger(monto) || monto < min) throw new Error(`La oferta mínima es ${fmtQ(min)}.`);
        tx.update(ref, { ofertaActual: monto, ganadorId: usuario.uid, totalPujas: (d.totalPujas || 0) + 1 });
        tx.set(doc(db, 'vehiculos', id, 'postores', usuario.uid), { monto, fecha: serverTimestamp() });
      });
      participo = true;
      mensaje('success', `¡Oferta de ${fmtQ(monto)} registrada!`);
    } catch (err) {
      mensaje('danger', err.code === 'permission-denied' ? 'El servidor rechazó la oferta (no cumple las reglas de la subasta).' : err.message);
    }
  }

  // Tiempo real: oferta actual, indicadores y estado sin recargar
  listeners.push(onSnapshot(ref, s => {
    if (!s.exists()) { vista().innerHTML = '<p class="text-muted">Vehículo no encontrado.</p>'; return; }
    const antes = v?.estadoCodigo;
    v = s.data();
    $('#ficha').innerHTML = [
      ['Año', v.anio], ['Tipo de artículo', v.tipoArticulo], ['Marca', v.marca], ['Modelo', v.modelo],
      ['Motor', v.motor], ['Transmisión', v.transmision], ['Tipo de combustible', v.combustible],
      ['Tren de manejo', v.tren], ['Número de cilindros', v.cilindros],
      ['Inicio de subasta', v.fechaInicio.toDate().toLocaleString('es-GT')],
      ['Cierre de subasta', v.fechaCierre.toDate().toLocaleString('es-GT')]
    ].map(([k, x]) => `<tr><td>${k}</td><td class="fw-semibold">${esc(x)}</td></tr>`).join('');
    // Evitar borrar lo que el usuario está escribiendo si solo cambió la oferta
    pintarPanel();
  }, err => mensaje('danger', err.message)));

  // Reloj: cada segundo; si cambia el estado (inicia/cierra), se repinta el panel
  let codigoPrevio = null;
  intervalos.push(setInterval(() => {
    if (!v) return;
    const e = estadoSubasta(v);
    if (codigoPrevio && e.codigo !== codigoPrevio) pintarPanel();
    codigoPrevio = e.codigo;
    const r = $('#reloj'); if (r) r.textContent = restante(e.ms);
  }, 1000));
}
