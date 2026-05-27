import { db, logout, onAuthChange } from "./firebase.js";
import {
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let clientes = [];
let prestamos = [];
let userId = null;

function fechaLocal(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function normalizarFecha(fecha) {
  if (!fecha) return '';
  if (typeof fecha === 'object' && typeof fecha.toDate === 'function') {
    return fechaLocal(fecha.toDate());
  }
  if (typeof fecha === 'string') {
    return fecha.slice(0, 10);
  }
  if (fecha instanceof Date) {
    return fechaLocal(fecha);
  }
  return String(fecha).slice(0, 10);
}

function formatearFecha(fecha) {
  if (!fecha) return '-';
  const [y, m, d] = fecha.split('-');
  return `${d}/${m}/${y}`;
}

function formatearMoneda(valor) {
  return '$' + Number(valor || 0).toLocaleString('es-CO');
}

function mostrarToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2800);
}

async function cargarTodo() {
  if (!userId) return;
  try {
    const [snapC, snapP] = await Promise.all([
      getDocs(query(collection(db, 'clientes'), where('userId', '==', userId))),
      getDocs(query(collection(db, 'prestamos'), where('userId', '==', userId)))
    ]);

    clientes = snapC.docs.map(d => ({ id: d.id, ...d.data() }));
    prestamos = snapP.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('Error cargando datos:', err);
    mostrarToast('No se pudieron cargar los préstamos.');
  }
}

function obtenerFechaPrestamo(prestamo) {
  return normalizarFecha(prestamo.fechaPrestamo || prestamo.fechaInicio || prestamo.fecha || '');
}

function renderPrestamosDiarios() {
  const cont = document.getElementById('prestamosDiariosContenido');
  if (!cont) return;

  if (prestamos.length === 0) {
    cont.innerHTML = `<div class="reporte-placeholder">No hay préstamos registrados.</div>`;
    return;
  }

  const prestamosOrdenados = prestamos
    .slice()
    .sort((a, b) => obtenerFechaPrestamo(b).localeCompare(obtenerFechaPrestamo(a)));

  const grupos = prestamosOrdenados.reduce((acc, prestamo) => {
    const fecha = obtenerFechaPrestamo(prestamo) || 'Sin fecha';
    acc[fecha] = acc[fecha] || [];
    acc[fecha].push(prestamo);
    return acc;
  }, {});

  cont.innerHTML = Object.keys(grupos).map(fecha => {
    const grupo = grupos[fecha];
    const totalDia = grupo.reduce((sum, p) => sum + Number(p.monto || 0), 0);
    return `
      <section class="reporte-seccion">
        <div class="detalle-fecha">
          <h3>${fecha === 'Sin fecha' ? 'Fecha no disponible' : formatearFecha(fecha)}</h3>
          <span class="detalle-total">Total: ${formatearMoneda(totalDia)}</span>
        </div>
        <div class="tabla-pagos-container">
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Monto</th>
                <th>Frecuencia</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${grupo.map(prestamo => {
                const cliente = clientes.find(c => c.id === prestamo.clienteId);
                return `
                  <tr>
                    <td>${cliente ? cliente.nombre : '-'}</td>
                    <td>${formatearMoneda(prestamo.monto)}</td>
                    <td>${prestamo.frecuencia || '-'}</td>
                    <td>${prestamo.estado || '-'}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }).join('');
}

onAuthChange(async user => {
  if (!user) {
    window.location.href = 'login.html';
    return;
  }

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
  renderPrestamosDiarios();
});
