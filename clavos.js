import { db, logout, onAuthChange } from "./firebase.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let clientes = [];
let prestamos = [];
let pagos = [];
let userId = null;

function fechaLocal(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function normalizarFecha(fecha) {
  if (!fecha) return '';
  if (typeof fecha === 'object' && typeof fecha.toDate === 'function') return fechaLocal(fecha.toDate());
  if (typeof fecha === 'string') return fecha.slice(0, 10);
  if (fecha instanceof Date) return fechaLocal(fecha);
  return String(fecha).slice(0, 10);
}

function formatearMoneda(v) { return '$' + Number(v || 0).toLocaleString('es-CO'); }

function hoy() { return fechaLocal(); }

function totalCobradoReal(prestamoId) {
  return pagos
    .filter(pg => pg.prestamoId === prestamoId)
    .reduce((s, pg) => s + Number(pg.valor || 0), 0);
}

function saldoReal(prestamo) {
  return Math.max(0, Number(prestamo.total || 0) - totalCobradoReal(prestamo.id));
}

function esClavo(clienteId) {
  const prestamosDelCliente = prestamos.filter(p => p.clienteId === clienteId && p.estado === 'Activo');
  if (prestamosDelCliente.length === 0) return false;

  const fechaHoy = new Date();
  const hace3Meses = new Date(fechaHoy.getFullYear(), fechaHoy.getMonth() - 3, fechaHoy.getDate());

  for (const prestamo of prestamosDelCliente) {
    if (!Array.isArray(prestamo.cuotas)) continue;
    for (const cuota of prestamo.cuotas) {
      if (cuota.estado === 'pendiente' || cuota.estado === 'mora') {
        const fechaCuota = normalizarFecha(cuota.fecha);
        if (!fechaCuota) continue;
        const [año, mes, dia] = fechaCuota.split('-');
        const fechaCuotaObj = new Date(parseInt(año, 10), parseInt(mes, 10) - 1, parseInt(dia, 10));
        if (fechaCuotaObj < hace3Meses) {
          return true;
        }
      }
    }
  }
  return false;
}

async function cargarTodo() {
  if (!userId) return;
  try {
    const [snapC, snapP, snapPg] = await Promise.all([
      getDocs(query(collection(db, 'clientes'), where('userId', '==', userId))),
      getDocs(query(collection(db, 'prestamos'), where('userId', '==', userId))),
      getDocs(query(collection(db, 'pagos'), where('userId', '==', userId)))
    ]);
    clientes = snapC.docs.map(d => ({ id: d.id, ...d.data() }));
    prestamos = snapP.docs.map(d => ({ id: d.id, ...d.data() }));
    pagos = snapPg.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('Error cargando datos de clavos:', err);
  }
}

function calcularClientesClavo() {
  return clientes.filter(c => esClavo(c.id));
}

function calcularPrestamosClavo(clientesClavo) {
  return prestamos
    .filter(p => p.estado === 'Activo' && clientesClavo.some(c => c.id === p.clienteId))
    .map(p => ({
      ...p,
      cliente: clientes.find(c => c.id === p.clienteId),
      cobrado: totalCobradoReal(p.id),
      saldo: saldoReal(p),
      mora: Array.isArray(p.cuotas) ? p.cuotas.filter(c => c.estado === 'mora').length : 0
    }));
}

function renderClavos() {
  const clientesClavo = calcularClientesClavo();
  const prestamosClavo = calcularPrestamosClavo(clientesClavo);
  const totalClavos = prestamosClavo.reduce((s, p) => s + Number(p.saldo || 0), 0);

  const cont = document.getElementById('clavosContenido');
  if (!cont) return;

  cont.innerHTML = `
    <div class="clavos-summary">
      <div class="clavos-card">
        <h3>Clientes en clavos</h3>
        <p>Personas con préstamos en mora de más de 3 meses.</p>
        <div class="value">${clientesClavo.length}</div>
      </div>
      <div class="clavos-card">
        <h3>Préstamos en clavos</h3>
        <p>Préstamos activos asociados a clientes en clavos.</p>
        <div class="value">${prestamosClavo.length}</div>
      </div>
      <div class="clavos-card">
        <h3>Total en clavos</h3>
        <p>Saldo pendiente calculado sobre préstamos activos.</p>
        <div class="value">${formatearMoneda(totalClavos)}</div>
      </div>
    </div>

    <div class="clavos-card" style="margin-bottom:16px;">
      <h3>Detalles de clavos</h3>
      <p class="clavos-note">Revisa los clientes y préstamos con saldo mayor en clavos. Aquí tienes la información principal sin sobrecargar Reportes.</p>
    </div>

    <div class="tabla-clavos-container">
      <table>
        <thead>
          <tr>
            <th>Cliente</th>
            <th>Préstamo</th>
            <th>Total</th>
            <th>Cobrado</th>
            <th>Saldo</th>
            <th>Moras</th>
          </tr>
        </thead>
        <tbody>
          ${prestamosClavo.length === 0
            ? `<tr><td colspan="6" style="text-align:center;padding:18px 0;color:#6b7280;">No hay clavos registrados.</td></tr>`
            : prestamosClavo.map(p => `
              <tr>
                <td>${p.cliente ? p.cliente.nombre : '-'}<br/><small style="color:#6b7280;">${p.cliente ? p.cliente.telefono || '-' : ''}</small></td>
                <td>${p.nombre || p.id || '-'}</td>
                <td>${formatearMoneda(p.total)}</td>
                <td>${formatearMoneda(p.cobrado)}</td>
                <td>${formatearMoneda(p.saldo)}</td>
                <td><span class="badge-mora">${p.mora}</span></td>
              </tr>
            `).join('')}
        </tbody>
      </table>
    </div>
  `;
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
  renderClavos();
});
