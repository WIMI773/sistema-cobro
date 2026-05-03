import { db, logout, onAuthChange } from "./firebase.js";
import {
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let clientes  = [];
let prestamos = [];
let pagos     = [];
let userId    = null;

let periodoActivo = 'hoy';
let rangoDesde    = '';
let rangoHasta    = '';

function fechaLocal(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function normalizarFecha(fecha) {
  if (!fecha) return '';
  if (typeof fecha === 'object' && typeof fecha.toDate === 'function') {
    return fechaLocal(fecha.toDate());
  }
  return String(fecha).slice(0, 10);
}

function inicioSemana() {
  const d = new Date();
  const dia = d.getDay();
  const lunes = new Date(d);
  lunes.setDate(d.getDate() - ((dia + 6) % 7));
  return fechaLocal(lunes);
}

function inicioMes() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function hoy() { return fechaLocal(); }

function getRango() {
  switch (periodoActivo) {
    case 'hoy':    return { desde: hoy(),         hasta: hoy() };
    case 'semana': return { desde: inicioSemana(), hasta: hoy() };
    case 'mes':    return { desde: inicioMes(),    hasta: hoy() };
    case 'rango':  return { desde: rangoDesde,     hasta: rangoHasta };
    default:       return { desde: hoy(),          hasta: hoy() };
  }
}

function formatearFecha(f) {
  if (!f) return '-';
  const [y, m, d] = f.split('-');
  return `${d}/${m}/${y}`;
}

function formatearMoneda(v) {
  return '$' + Number(v || 0).toLocaleString('es-CO');
}

function enRango(fecha, desde, hasta) {
  const f = normalizarFecha(fecha);
  return f >= desde && f <= hasta;
}

function etiquetaPeriodo(desde, hasta) {
  if (desde === hasta) return `Reporte del ${formatearFecha(desde)}`;
  return `Del ${formatearFecha(desde)} al ${formatearFecha(hasta)}`;
}

function totalCobradoReal(prestamoId) {
  return pagos
    .filter(pg => pg.prestamoId === prestamoId)
    .reduce((s, pg) => s + Number(pg.valor || 0), 0);
}

function saldoReal(prestamo) {
  return Math.max(0, Number(prestamo.total || 0) - totalCobradoReal(prestamo.id));
}

// Devuelve true si el cliente tiene al menos una cuota vencida HOY o antes
// (mora o pendiente con fecha <= hoy). Excluye clientes cuya primera cuota
// aún no ha llegado (préstamo hecho hoy, cobra desde mañana).
function tieneDeudaVencida(clienteId) {
  const fechaHoy = hoy();
  return prestamos.some(p => {
    if (p.clienteId !== clienteId || p.estado !== 'Activo') return false;
    if (!Array.isArray(p.cuotas)) return false;
    return p.cuotas.some(c =>
      (c.estado === 'mora' || c.estado === 'pendiente' || c.estado === 'parcial') &&
      normalizarFecha(c.fecha) <= fechaHoy
    );
  });
}

async function cargarTodo() {
  if (!userId) return;
  const [snapC, snapP, snapPg] = await Promise.all([
    getDocs(query(collection(db, 'clientes'),  where('userId', '==', userId))),
    getDocs(query(collection(db, 'prestamos'), where('userId', '==', userId))),
    getDocs(query(collection(db, 'pagos'),     where('userId', '==', userId)))
  ]);
  clientes  = snapC.docs.map(d  => ({ id: d.id, ...d.data() }));
  prestamos = snapP.docs.map(d  => ({ id: d.id, ...d.data() }));
  pagos     = snapPg.docs.map(d => ({ id: d.id, ...d.data() }));
}

function renderReporte() {
  const { desde, hasta } = getRango();

  document.getElementById('periodoLabel').textContent = etiquetaPeriodo(desde, hasta);

  const pagosFiltrados = pagos.filter(p => enRango(p.fecha, desde, hasta));
  const totalRecaudado = pagosFiltrados.reduce((s, p) => s + Number(p.valor || 0), 0);

  const clientesQuePageron = new Set(pagosFiltrados.map(p => p.clienteId));
  const prestamosActivos   = prestamos.filter(p => p.estado === 'Activo');

  let totalMora = 0;
  const totalPrestado = prestamosActivos.reduce((suma, p) => {
    if (Array.isArray(p.cuotas)) {
      totalMora += p.cuotas.filter(c => c.estado === 'mora').length;
    }
    return suma + saldoReal(p);
  }, 0);

  // Clientes que pagaron en el período
  const clientesConPago = clientes.filter(c => clientesQuePageron.has(c.id));

  // Clientes sin pago en el período PERO solo si tienen cuotas vencidas hoy o antes
  // → no aparece el cliente si su préstamo es de hoy y cobra desde mañana
  const clientesSinPago = clientes.filter(c =>
    !clientesQuePageron.has(c.id) && tieneDeudaVencida(c.id)
  );

  function montoPagadoPorCliente(clienteId) {
    return pagosFiltrados
      .filter(p => p.clienteId === clienteId)
      .reduce((s, p) => s + Number(p.valor || 0), 0);
  }

  const cont = document.getElementById('reporteContenido');

  cont.innerHTML = `
    <div class="reporte-stats">
      <div class="reporte-stat-card verde">
        <div class="stat-label">Recaudado</div>
        <div class="stat-value">${formatearMoneda(totalRecaudado)}</div>
      </div>
      <div class="reporte-stat-card azul">
        <div class="stat-label">Pagos registrados</div>
        <div class="stat-value">${pagosFiltrados.length}</div>
      </div>
      <div class="reporte-stat-card verde">
        <div class="stat-label">Clientes pagaron</div>
        <div class="stat-value">${clientesConPago.length}</div>
      </div>
      <div class="reporte-stat-card rojo">
        <div class="stat-label">Sin pago</div>
        <div class="stat-value">${clientesSinPago.length}</div>
      </div>
      <div class="reporte-stat-card azul">
        <div class="stat-label">Préstamos activos</div>
        <div class="stat-value">${prestamosActivos.length}</div>
      </div>
      <div class="reporte-stat-card ambar">
        <div class="stat-label">Cuotas en mora</div>
        <div class="stat-value">${totalMora}</div>
      </div>
      <div class="reporte-stat-card ambar">
        <div class="stat-label">Total prestado</div>
        <div class="stat-value">${formatearMoneda(totalPrestado)}</div>
      </div>
    </div>

    <div class="card reporte-seccion">
      <h3>✅ Clientes que pagaron (${clientesConPago.length})</h3>
      ${clientesConPago.length === 0
        ? `<div class="reporte-placeholder">Ningún cliente pagó en este período.</div>`
        : clientesConPago.map(c => `
          <div class="cliente-fila pagado">
            <span class="dot verde"></span>
            <img class="cliente-fila-avatar"
              src="${c.foto || 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80'}"
              alt="${c.nombre}" />
            <div class="cliente-fila-info">
              <strong>${c.nombre}</strong>
              <span>${c.telefono || '-'}</span>
            </div>
            <div class="cliente-fila-monto">${formatearMoneda(montoPagadoPorCliente(c.id))}</div>
          </div>
        `).join('')
      }
    </div>

    <div class="card reporte-seccion">
      <h3>❌ Clientes sin pago (${clientesSinPago.length})</h3>
      ${clientesSinPago.length === 0
        ? `<div class="reporte-placeholder">No hay clientes con cuotas vencidas sin pagar. 🎉</div>`
        : clientesSinPago.map(c => `
            <div class="cliente-fila no-pago">
              <span class="dot rojo"></span>
              <img class="cliente-fila-avatar"
                src="${c.foto || 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80'}"
                alt="${c.nombre}" />
              <div class="cliente-fila-info">
                <strong>${c.nombre}</strong>
                <span>${c.telefono || '-'}</span>
              </div>
              <div class="cliente-fila-monto" style="color:#b91c1c;">Pendiente</div>
            </div>
          `).join('')
      }
    </div>

    <div class="card reporte-seccion">
      <h3>📋 Detalle de pagos del período</h3>
      ${pagosFiltrados.length === 0
        ? `<div class="reporte-placeholder">No hay pagos en este período.</div>`
        : `<div class="tabla-pagos-container">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Cuota N°</th>
                  <th>Valor pagado</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                ${pagosFiltrados
                  .sort((a, b) => normalizarFecha(b.fecha).localeCompare(normalizarFecha(a.fecha)))
                  .map(p => {
                    const cliente = clientes.find(c => c.id === p.clienteId);
                    return `
                      <tr>
                        <td>${cliente ? cliente.nombre : '-'}</td>
                        <td>${p.cuotaNumero || '-'}</td>
                        <td>${formatearMoneda(p.valor)}</td>
                        <td>${formatearFecha(normalizarFecha(p.fecha))}</td>
                      </tr>
                    `;
                  }).join('')}
              </tbody>
            </table>
          </div>`
      }
    </div>

    <div class="card reporte-seccion">
      <h3>💰 Préstamos activos y saldos</h3>
      ${prestamosActivos.length === 0
        ? `<div class="reporte-placeholder">No hay préstamos activos.</div>`
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
                  const mora    = Array.isArray(p.cuotas)
                    ? p.cuotas.filter(c => c.estado === 'mora').length
                    : 0;
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
          </div>`
      }
    </div>
  `;
}

window.setPeriodo = function(periodo) {
  periodoActivo = periodo;
  ['hoy', 'semana', 'mes', 'rango'].forEach(p => {
    document.getElementById(`btn-${p}`).classList.toggle('active', p === periodo);
  });
  document.getElementById('rangoInputs').classList.toggle('hidden', periodo !== 'rango');
  if (periodo !== 'rango') renderReporte();
};

window.aplicarRango = function() {
  rangoDesde = document.getElementById('fechaDesde').value;
  rangoHasta = document.getElementById('fechaHasta').value;
  if (!rangoDesde || !rangoHasta) {
    alert('Selecciona las dos fechas.');
    return;
  }
  if (rangoDesde > rangoHasta) {
    alert('La fecha de inicio no puede ser mayor a la fecha final.');
    return;
  }
  renderReporte();
};

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
  renderReporte();
});