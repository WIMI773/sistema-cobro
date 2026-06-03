import { db, logout, onAuthChange } from "./firebase.js";
import { collection, query, where, getDocs, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let userId = null;
let clientes = [];
let prestamos = [];
let pagos = [];
let gastos = [];
let basesDaily = {};
let baseFirestorePermisos = true;

function fechaLocal(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function normalizarFecha(fecha) {
  if (!fecha) return '';
  if (typeof fecha === 'object' && typeof fecha.toDate === 'function') return fechaLocal(fecha.toDate());
  if (typeof fecha === 'string') return fecha.slice(0, 10);
  if (fecha instanceof Date) return fechaLocal(fecha);
  return String(fecha).slice(0, 10);
}

function formatearMoneda(v) {
  return '$' + Number(v || 0).toLocaleString('es-CO');
}

function claveBaseDiaria(fecha) {
  return `baseDiaria_${userId || 'anon'}_${fecha}`;
}

async function cargarBaseDiaria(fecha) {
  if (!userId || !fecha || !baseFirestorePermisos) return;
  const id = `base_${userId}_${fecha}`;
  try {
    const snap = await getDoc(doc(db, 'bases', id));
    if (snap.exists()) {
      const data = snap.data();
      basesDaily[fecha] = Number(data.valor || 0);
    }
  } catch (err) {
    if (String(err).includes('Missing or insufficient permissions')) {
      baseFirestorePermisos = false;
      mostrarToast('Permisos de Firestore insuficientes para cargar la base diaria.');
    } else {
      console.warn('No se pudo cargar la base diaria:', err);
    }
  }
}

function baseParaFecha(fecha) {
  if (!fecha) return 0;
  if (typeof basesDaily[fecha] !== 'undefined') return Number(basesDaily[fecha] || 0);
  const valor = localStorage.getItem(claveBaseDiaria(fecha));
  return Number(valor || 0);
}

async function guardarBaseDiaria(fecha, valor) {
  if (!fecha) return;
  const numero = Number(valor || 0);
  basesDaily[fecha] = numero;
  localStorage.setItem(claveBaseDiaria(fecha), String(numero));

  if (!userId || !baseFirestorePermisos) return;
  try {
    await setDoc(doc(db, 'bases', `base_${userId}_${fecha}`), {
      userId,
      fecha,
      valor: numero,
      actualizado: new Date().toISOString()
    });
  } catch (err) {
    if (String(err).includes('Missing or insufficient permissions')) {
      baseFirestorePermisos = false;
      mostrarToast('Base guardada localmente. Ajusta permisos de Firestore para guardarla en la nube.');
    } else {
      console.warn('No se pudo guardar la base en Firestore:', err);
    }
  }
}

function fechaAnterior(fecha) {
  const d = new Date(fecha);
  d.setDate(d.getDate() - 1);
  return fechaLocal(d);
}

function calcularEfectivoNetoDeFecha(fecha) {
  const pagosDelDia = pagos.filter(p => enRango(p.fecha, fecha));
  const gastosDelDia = gastos.filter(g => enRango(g.fecha, fecha));
  const prestamosDelDia = prestamos.filter(p => enRango(p.fechaPrestamo || p.fechaInicio || p.fecha, fecha));
  const totalPrestamos = prestamosDelDia.reduce((sum, p) => sum + Number(p.monto || 0), 0);
  const totalRecaudado = pagosDelDia.reduce((sum, p) => sum + Number(p.valor || 0), 0);
  const totalGastos = gastosDelDia.reduce((sum, g) => sum + Number(g.valor || 0), 0);
  const baseDia = baseParaFecha(fecha);
  return Number(baseDia || 0) + Number(totalRecaudado || 0) - Number(totalPrestamos || 0) - Number(totalGastos || 0);
}

async function aplicarBaseDesdeCierrePrevio(fecha) {
  if (!fecha || baseParaFecha(fecha) > 0) return;
  const anterior = fechaAnterior(fecha);
  const efectivoAnterior = calcularEfectivoNetoDeFecha(anterior);
  if (efectivoAnterior !== 0) {
    await guardarBaseDiaria(fecha, efectivoAnterior);
    mostrarToast('Base diaria cargada desde el cierre del día anterior.');
  }
}

function iniciarReinicioCierre() {
  let ultimoDiaCierre = fechaLocal();

  const actualizarAlNuevoDia = async () => {
    const hoyActual = fechaLocal();
    if (hoyActual !== ultimoDiaCierre) {
      ultimoDiaCierre = hoyActual;
      const fechaInput = document.getElementById('fechaCierre');
      if (fechaInput) fechaInput.value = hoyActual;
      await cargarBaseDiaria(hoyActual);
      await aplicarBaseDesdeCierrePrevio(hoyActual);
      renderCierre(hoyActual);
      mostrarToast('El cierre se actualizó al nuevo día.');
    }
  };

  const ahora = new Date();
  const manana = new Date(ahora);
  manana.setDate(ahora.getDate() + 1);
  manana.setHours(0, 0, 5, 0);
  const msHastaMedianoche = manana.getTime() - ahora.getTime();

  setTimeout(() => {
    actualizarAlNuevoDia();
    setInterval(actualizarAlNuevoDia, 24 * 60 * 60 * 1000);
  }, Math.max(msHastaMedianoche, 0));
}

async function cargarTodo() {
  if (!userId) return;
  try {
    const [snapC, snapP, snapPg, snapG] = await Promise.all([
      getDocs(query(collection(db, 'clientes'), where('userId', '==', userId))),
      getDocs(query(collection(db, 'prestamos'), where('userId', '==', userId))),
      getDocs(query(collection(db, 'pagos'), where('userId', '==', userId))),
      getDocs(query(collection(db, 'gastos'), where('userId', '==', userId)))
    ]);
    clientes = snapC.docs.map(d => ({ id: d.id, ...d.data() }));
    prestamos = snapP.docs.map(d => ({ id: d.id, ...d.data() }));
    pagos = snapPg.docs.map(d => ({ id: d.id, ...d.data() }));
    gastos = snapG.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('Error cargando datos de cierre:', err);
  }
}

function enRango(fecha, fechaObjetivo) {
  const f = normalizarFecha(fecha);
  return f === fechaObjetivo;
}

function renderCierre(fechaCierre) {
  const pagosDelDia = pagos.filter(p => enRango(p.fecha, fechaCierre));
  const gastosDelDia = gastos.filter(g => enRango(g.fecha, fechaCierre));
  const prestamosDelDia = prestamos.filter(p => enRango(p.fechaPrestamo || p.fechaInicio || p.fecha, fechaCierre));

  const totalPrestamos = prestamosDelDia.reduce((sum, p) => sum + Number(p.monto || 0), 0);
  const totalRecaudado = pagosDelDia.reduce((sum, p) => sum + Number(p.valor || 0), 0);
  const totalGastos = gastosDelDia.reduce((sum, g) => sum + Number(g.valor || 0), 0);
  const baseDia = baseParaFecha(fechaCierre);
  // Efectivo en caja = base inicial + recaudado - préstamos entregados - gastos
  const efectivoNeto = Number(baseDia || 0) + Number(totalRecaudado || 0) - Number(totalPrestamos || 0) - Number(totalGastos || 0);
  // Disponible respecto a la base: positivo = sobra para entregar, negativo = falta para cubrir la base
  const disponible = efectivoNeto - Number(baseDia || 0);

  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  setText('cierrePrestamosCount', prestamosDelDia.length);
  setText('cierrePrestamosValor', formatearMoneda(totalPrestamos));
  setText('cierreRecaudado', formatearMoneda(totalRecaudado));
  setText('cierreGastos', formatearMoneda(totalGastos));
  setText('cierreBase', formatearMoneda(baseDia));
  setText('cierreEfectivo', formatearMoneda(efectivoNeto));

  const disponibleText = disponible >= 0
    ? `Efectivo disponible: ${formatearMoneda(disponible)}.`
    : `Revisión necesaria: el efectivo neto no cubre la base diaria, falta ${formatearMoneda(Math.abs(disponible))}.`;
  setText('cierreDisponible', disponibleText);

  document.getElementById('cierreTblPrestamosCount').textContent = prestamosDelDia.length;
  document.getElementById('cierreTblPrestamosDetalle').textContent = `Últimos ${Math.min(prestamosDelDia.length, 3)} préstamos registrados en el día.`;
  document.getElementById('cierreTblPagosValor').textContent = formatearMoneda(totalRecaudado);
  document.getElementById('cierreTblPagosDetalle').textContent = `${pagosDelDia.length} pagos registrados.`;
  document.getElementById('cierreTblGastosValor').textContent = formatearMoneda(totalGastos);
  document.getElementById('cierreTblGastosDetalle').textContent = `${gastosDelDia.length} gastos registrados.`;
  document.getElementById('cierreTblBaseValor').textContent = formatearMoneda(baseDia);
  document.getElementById('cierreTblBaseDetalle').textContent = baseDia > 0
    ? 'Base del día disponible para cierre.'
    : 'No se encontró base registrada para esta fecha.';

  const detalleExtras = document.getElementById('cierreDetalleExtras');
  const meses = new Set(prestamosDelDia.map(p => p.frecuencia || 'N/A'));
  const prestamoClientes = new Set(prestamosDelDia.map(p => p.clienteId));
  detalleExtras.style.display = 'block';
  detalleExtras.innerHTML = `
    <h3>Resumen adicional</h3>
    <p><strong>Clientes atendidos:</strong> ${prestamoClientes.size}</p>
    <p><strong>Frecuencias registradas:</strong> ${[...meses].join(', ') || 'Sin datos'}</p>
    <p>Utiliza este cierre para que tus cuentas diarias no se descuadren: compara el total recaudado con gastos, base y efectivo disponible.</p>
  `;
}

window.actualizarCierre = async function() {
  const fechaInput = document.getElementById('fechaCierre');
  const fecha = fechaInput ? fechaInput.value : fechaLocal();
  if (!fecha) {
    mostrarToast('Selecciona una fecha de cierre válida.');
    return;
  }
  await cargarBaseDiaria(fecha);
  if (fecha === fechaLocal()) {
    await aplicarBaseDesdeCierrePrevio(fecha);
  }
  renderCierre(fecha);
};

window.confirmarCerrarManual = async function() {
  const fechaInput = document.getElementById('fechaCierre');
  const fecha = fechaInput ? fechaInput.value : fechaLocal();
  if (!fecha) {
    mostrarToast('Selecciona una fecha de cierre válida.');
    return;
  }

  const confirmar = window.confirm('¿Deseas cerrar este día?');
  if (!confirmar) return;

  await cargarBaseDiaria(fecha);
  renderCierre(fecha);
  mostrarToast(`Cierre manual realizado para ${fecha}.`);
};

window.exportarPDF = function() {
  window.print();
};

document.addEventListener('DOMContentLoaded', () => {
  const exportBtn = document.getElementById('exportarPdfButton');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => window.print());
  }

  const actualizarBtn = document.getElementById('actualizarCierreButton');
  if (actualizarBtn) {
    actualizarBtn.addEventListener('click', () => {
      window.actualizarCierre();
    });
  }

  const cerrarManualBtn = document.getElementById('cerrarManualButton');
  if (cerrarManualBtn) {
    cerrarManualBtn.addEventListener('click', () => {
      window.confirmarCerrarManual();
    });
  }
});

function mostrarToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2800);
}

onAuthChange(async user => {
  if (!user) { window.location.href = 'login.html'; return; }
  userId = user.uid;
  const emailEl = document.getElementById('usuarioEmail');
  if (emailEl) emailEl.textContent = user.email || '';
  const logoutBtn = document.getElementById('logoutButton');
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      await logout();
      window.location.href = 'login.html';
    };
  }
  await cargarTodo();
  const fechaInput = document.getElementById('fechaCierre');
  const hoyFecha = fechaLocal();
  if (fechaInput) {
    fechaInput.value = hoyFecha;
  }
  await cargarBaseDiaria(hoyFecha);
  await aplicarBaseDesdeCierrePrevio(hoyFecha);
  renderCierre(hoyFecha);
  iniciarReinicioCierre();

  const exportBtn = document.getElementById('exportarPdfButton');
  if (exportBtn) {
    exportBtn.onclick = () => window.print();
  }
});
