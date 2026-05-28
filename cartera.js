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
  if (typeof fecha === 'string') return fecha.slice(0,10);
  if (fecha instanceof Date) return fechaLocal(fecha);
  return String(fecha).slice(0,10);
}

function formatearMoneda(v) { return '$' + Number(v || 0).toLocaleString('es-CO'); }

function totalCobradoReal(prestamoId) {
  return pagos
    .filter(pg => pg.prestamoId === prestamoId)
    .reduce((s, pg) => s + Number(pg.valor || 0), 0);
}

function saldoReal(prestamo) {
  return Math.max(0, Number(prestamo.total || 0) - totalCobradoReal(prestamo.id));
}

async function cargarTodo() {
  if (!userId) return;
  try {
    const [snapC, snapP, snapPg] = await Promise.all([
      getDocs(query(collection(db, 'clientes'), where('userId', '==', userId))),
      getDocs(query(collection(db, 'prestamos'), where('userId', '==', userId))),
      getDocs(query(collection(db, 'pagos'), where('userId', '==', userId)))
    ]);
    clientes  = snapC.docs.map(d  => ({ id: d.id, ...d.data() }));
    prestamos = snapP.docs.map(d  => ({ id: d.id, ...d.data() }));
    pagos     = snapPg.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('Error cargando cartera:', err);
  }
}

function renderCartera() {
  const prestamosActivos = prestamos.filter(p => p.estado === 'Activo');
  const totalPrestado = prestamosActivos.reduce((s, p) => s + saldoReal(p), 0);

  const cont = document.getElementById('carteraContenido');
  if (!cont) return;

  cont.innerHTML = `
    <div class="card reporte-seccion">
      <h3>💼 Resumen de cartera</h3>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;">
        <div class="cartera-total">Total en cartera: ${formatearMoneda(totalPrestado)}</div>
        <div style="color:#6b7280;font-weight:600;">Préstamos activos: ${prestamosActivos.length}</div>
      </div>
      ${prestamosActivos.length === 0
        ? `<div class="reporte-placeholder">No hay cartera registrada.</div>`
        : `<div class="tabla-pagos-container">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Total</th>
                  <th>Cobrado</th>
                  <th>Saldo</th>
                  <th>Mora</th>
                  <th>Frecuencia</th>
                </tr>
              </thead>
              <tbody>
                ${prestamosActivos.map(p => {
                  const cliente = clientes.find(c => c.id === p.clienteId);
                  const cobrado = totalCobradoReal(p.id);
                  const saldo   = saldoReal(p);
                  const mora    = Array.isArray(p.cuotas) ? p.cuotas.filter(c => c.estado === 'mora').length : 0;
                  return `
                    <tr>
                      <td>${cliente ? cliente.nombre : '-'}</td>
                      <td>${formatearMoneda(p.total)}</td>
                      <td>${formatearMoneda(cobrado)}</td>
                      <td>${formatearMoneda(saldo)}</td>
                      <td>${mora > 0 ? `<span class="badge mora">${mora}</span>` : '0'}</td>
                      <td>${p.frecuencia || '-'}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>`}
    </div>
  `;
}

onAuthChange(async user => {
  if (!user) { window.location.href = 'login.html'; return; }
  userId = user.uid;
  const emailEl = document.getElementById('usuarioEmail'); if (emailEl) emailEl.textContent = user.email || '';
  const logoutBtn = document.getElementById('logoutButton'); if (logoutBtn) logoutBtn.onclick = async () => { await logout(); window.location.href = 'login.html'; };
  await cargarTodo();
  renderCartera();
});
