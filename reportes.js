import { db, logout, onAuthChange } from "./firebase.js";
import {
  collection,
  query,
  where,
  getDocs,
  setDoc,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let clientes  = [];
let prestamos = [];
let pagos     = [];
let gastos    = [];
let basesDaily = {};
let userId    = null;
let baseFirestorePermisos = true;

let periodoActivo = 'hoy';
let rangoDesde    = '';
let rangoHasta    = '';
let ultimoDia     = '';

function fechaLocal(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function normalizarFecha(fecha) {
  if (!fecha) return '';
  
  // Si es un Timestamp de Firebase
  if (typeof fecha === 'object' && typeof fecha.toDate === 'function') {
    return fechaLocal(fecha.toDate());
  }
  
  // Si es una cadena de fecha ISO (YYYY-MM-DD)
  if (typeof fecha === 'string') {
    return fecha.slice(0, 10);
  }
  
  // Si es una Date
  if (fecha instanceof Date) {
    return fechaLocal(fecha);
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
        const [año, mes, día] = fechaCuota.split('-');
        const fechaCuotaObj = new Date(parseInt(año), parseInt(mes, 10) - 1, parseInt(día, 10));
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
    const [snapC, snapP, snapPg, snapG] = await Promise.all([
      getDocs(query(collection(db, 'clientes'),  where('userId', '==', userId))),
      getDocs(query(collection(db, 'prestamos'), where('userId', '==', userId))),
      getDocs(query(collection(db, 'pagos'),     where('userId', '==', userId))),
      getDocs(query(collection(db, 'gastos'),    where('userId', '==', userId)))
    ]);
    clientes  = snapC.docs.map(d  => ({ id: d.id, ...d.data() }));
    prestamos = snapP.docs.map(d  => ({ id: d.id, ...d.data() }));
    pagos     = snapPg.docs.map(d => ({ id: d.id, ...d.data() }));
    gastos    = snapG.docs.map(d => ({ id: d.id, ...d.data() }));
    await cargarBaseDiaria(hoy());
    console.log('Gastos cargados:', gastos);
  } catch (err) {
    console.error('Error cargando datos:', err);
  }
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
      mostrarToast('Base diaria cargada desde el navegador. Ajusta permisos de Firestore para guardarla en la nube.');
    } else {
      console.warn('No se pudo cargar la base de Firestore:', err);
    }
  }
}

function baseParaFecha(fecha) {
  if (!fecha) return 0;
  if (typeof basesDaily[fecha] !== 'undefined') {
    return Number(basesDaily[fecha] || 0);
  }
  const valor = localStorage.getItem(claveBaseDiaria(fecha));
  return Number(valor || 0);
}

async function guardarBaseDiaria(fecha, valor) {
  if (!fecha) return;
  localStorage.setItem(claveBaseDiaria(fecha), String(valor));
  basesDaily[fecha] = Number(valor || 0);

  if (!userId || !baseFirestorePermisos) return;
  const id = `base_${userId}_${fecha}`;
  try {
    await setDoc(doc(db, 'bases', id), {
      userId,
      fecha,
      valor: Number(valor || 0),
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

function mostrarToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2800);
}

window.guardarBaseHoy = async function() {
  const fecha = hoy();
  const input = document.getElementById('baseDiariaInput');
  if (!input) return;

  const valor = Number(input.value);
  if (Number.isNaN(valor) || valor < 0) {
    mostrarToast('Ingresa un valor numérico válido.');
    return;
  }

  await guardarBaseDiaria(fecha, valor);
  mostrarToast('Base diaria guardada');
  renderReporte();
};

function iniciarReinicioDiario() {
  ultimoDia = hoy();

  const actualizarAlNuevoDia = async () => {
    const hoyActual = hoy();
    if (hoyActual !== ultimoDia) {
      ultimoDia = hoyActual;
      await cargarBaseDiaria(hoyActual);
      renderReporte();
      mostrarToast('Se actualizó el reporte al nuevo día');
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

function renderReporte() {
  const { desde, hasta } = getRango();

  document.getElementById('periodoLabel').textContent = etiquetaPeriodo(desde, hasta);

  const pagosFiltrados = pagos.filter(p => enRango(p.fecha, desde, hasta));
  const totalRecaudado = pagosFiltrados.reduce((s, p) => s + Number(p.valor || 0), 0);

  const gastosFiltrados = gastos.filter(g => enRango(g.fecha, desde, hasta));
  const totalGastos = gastosFiltrados.reduce((s, g) => s + Number(g.valor || 0), 0);
  
  console.log('Gastos totales:', gastos);
  console.log('Rango:', { desde, hasta });
  console.log('Gastos filtrados:', gastosFiltrados);

  // Préstamos creados en el período (usar fechaPrestamo si existe)
  const prestamosFiltrados = prestamos.filter(p => enRango(p.fechaPrestamo || p.fechaInicio || p.fecha, desde, hasta));
  const totalPrestamosDiariosMonto = prestamosFiltrados.reduce((s, p) => s + Number(p.monto || 0), 0);

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
      <div class="reporte-stat-card rojo">
        <div class="stat-label">Total gastos</div>
        <div class="stat-value">${formatearMoneda(totalGastos)}</div>
      </div>
      <div id="prestamosDiariosCard" class="reporte-stat-card azul clickable" onclick="window.location.href='prestamosdiarios.html'">
        <div class="stat-label">Préstamos diarios</div>
        <div class="stat-value">${formatearMoneda(totalPrestamosDiariosMonto)}</div>
      </div>
      <div class="reporte-stat-card ambar">
        <div class="stat-label">Base diaria</div>
        <div class="stat-value">${formatearMoneda(baseParaFecha(hoy()))}</div>
      </div>
    </div>

    <div class="card reporte-seccion base-diaria-card">
      <h3>💰 Base diaria</h3>
      <div class="base-diaria-row">
        <label class="base-diaria-label">
          <span>Base del día</span>
          <input id="baseDiariaInput" type="number" min="0" step="100" value="${baseParaFecha(hoy())}" />
        </label>
        <button class="btn-primary small" onclick="guardarBaseHoy()">Guardar base</button>
      </div>
      <p class="nota">Guarda la base que usas para salir cada día y mantenla visible en el reporte.</p>
    </div>

    <div class="card reporte-seccion">
      <h3>💸 Préstamos del período (${prestamosFiltrados.length})</h3>
      ${prestamosFiltrados.length === 0
        ? `<div class="reporte-placeholder">No hay préstamos en este período.</div>`
        : (() => {
            const max = 4;
            const sorted = prestamosFiltrados.sort((a, b) => normalizarFecha(b.fechaPrestamo || b.fechaInicio || b.fecha).localeCompare(normalizarFecha(a.fechaPrestamo || a.fechaInicio || a.fecha)));
            const preview = sorted.slice(0, max).map(p => {
              const cliente = clientes.find(c => c.id === p.clienteId);
              return `
                <tr>
                  <td>${cliente ? cliente.nombre : '-'}</td>
                  <td>${formatearMoneda(p.monto)}</td>
                  <td>${formatearFecha(normalizarFecha(p.fechaPrestamo || p.fechaInicio || p.fecha))}</td>
                </tr>`;
            }).join('');
            const full = sorted.map(p => {
              const cliente = clientes.find(c => c.id === p.clienteId);
              return `
                <tr>
                  <td>${cliente ? cliente.nombre : '-'}</td>
                  <td>${formatearMoneda(p.monto)}</td>
                  <td>${formatearFecha(normalizarFecha(p.fechaPrestamo || p.fechaInicio || p.fecha))}</td>
                </tr>`;
            }).join('');
            return `
              <div class="tabla-pagos-container">
                <table>
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Monto</th>
                      <th>Fecha</th>
                    </tr>
                  </thead>
                  <tbody id="prestamosFiltrados_preview">
                    ${preview}
                    ${sorted.length > max ? `<tr><td colspan="3" style="text-align:center;"><button style="background:none;border:none;color:#2563eb;font-weight:700;cursor:pointer;padding:6px 0;" id="prestamosFiltrados_btn" onclick="toggleVerMas('prestamosFiltrados')">Ver más</button></td></tr>` : ''}
                  </tbody>
                  <tbody id="prestamosFiltrados_full" style="display:none;">
                    ${full}
                    ${sorted.length > max ? `<tr><td colspan="3" style="text-align:center;"><button style="background:none;border:none;color:#2563eb;font-weight:700;cursor:pointer;padding:6px 0;" onclick="toggleVerMas('prestamosFiltrados')">Ver menos</button></td></tr>` : ''}
                  </tbody>
                </table>
              </div>`;
        })()
      }
    </div>

    <div class="card reporte-seccion">
      <h3>✅ Clientes que pagaron (${clientesConPago.length})</h3>
      ${clientesConPago.length === 0
        ? `<div class="reporte-placeholder">Ningún cliente pagó en este período.</div>`
        : (() => {
            const max = 4;
            const previewItems = clientesConPago.slice(0, max).map(c => `
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
            `).join('');
            const fullItems = clientesConPago.map(c => `
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
            `).join('');
            return `
              <div id="clientesConPago_preview">${previewItems}${clientesConPago.length > max ? `<div style="text-align:center;margin-top:8px;"><button style="background:none;border:none;color:#2563eb;font-weight:700;cursor:pointer;padding:6px 0;" id="clientesConPago_btn" onclick="toggleVerMas('clientesConPago')">Ver más</button></div>` : ''}</div>
              <div id="clientesConPago_full" style="display:none;">${fullItems}${clientesConPago.length > max ? `<div style="text-align:center;margin-top:8px;"><button style="background:none;border:none;color:#2563eb;font-weight:700;cursor:pointer;padding:6px 0;" onclick="toggleVerMas('clientesConPago')">Ver menos</button></div>` : ''}</div>
            `;
        })()
      }
    </div>

    <div class="card reporte-seccion">
      <h3>❌ Clientes sin pago (${clientesSinPago.length})</h3>
      ${clientesSinPago.length === 0
        ? `<div class="reporte-placeholder">No hay clientes con cuotas vencidas sin pagar. 🎉</div>`
        : (() => {
            const max = 4;
            const preview = clientesSinPago.slice(0, max).map(c => `
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
            `).join('');
            const full = clientesSinPago.map(c => `
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
            `).join('');
            return `
              <div id="clientesSinPago_preview">${preview}${clientesSinPago.length > max ? `<div style="text-align:center;margin-top:8px;"><button style="background:none;border:none;color:#2563eb;font-weight:700;cursor:pointer;padding:6px 0;" id="clientesSinPago_btn" onclick="toggleVerMas('clientesSinPago')">Ver más</button></div>` : ''}</div>
              <div id="clientesSinPago_full" style="display:none;">${full}${clientesSinPago.length > max ? `<div style="text-align:center;margin-top:8px;"><button style="background:none;border:none;color:#2563eb;font-weight:700;cursor:pointer;padding:6px 0;" onclick="toggleVerMas('clientesSinPago')">Ver menos</button></div>` : ''}</div>
            `;
        })()
      }
    </div>

    <div class="card reporte-seccion">
      <h3>📋 Detalle de pagos del período</h3>
      ${pagosFiltrados.length === 0
        ? `<div class="reporte-placeholder">No hay pagos en este período.</div>`
        : (() => {
            const max = 6;
            const sorted = pagosFiltrados.sort((a, b) => normalizarFecha(b.fecha).localeCompare(normalizarFecha(a.fecha)));
            const preview = sorted.slice(0, max).map(p => {
              const cliente = clientes.find(c => c.id === p.clienteId);
              return `
                <tr>
                  <td>${cliente ? cliente.nombre : '-'}</td>
                  <td>${p.cuotaNumero || '-'}</td>
                  <td>${formatearMoneda(p.valor)}</td>
                  <td>${formatearFecha(normalizarFecha(p.fecha))}</td>
                </tr>`;
            }).join('');
            const full = sorted.map(p => {
              const cliente = clientes.find(c => c.id === p.clienteId);
              return `
                <tr>
                  <td>${cliente ? cliente.nombre : '-'}</td>
                  <td>${p.cuotaNumero || '-'}</td>
                  <td>${formatearMoneda(p.valor)}</td>
                  <td>${formatearFecha(normalizarFecha(p.fecha))}</td>
                </tr>`;
            }).join('');
            return `
              <div class="tabla-pagos-container">
                <table>
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Cuota N°</th>
                      <th>Valor pagado</th>
                      <th>Fecha</th>
                    </tr>
                  </thead>
                  <tbody id="pagosFiltrados_preview">
                    ${preview}
                    ${sorted.length > max ? `<tr><td colspan="4" style="text-align:center;"><button style="background:none;border:none;color:#2563eb;font-weight:700;cursor:pointer;padding:6px 0;" id="pagosFiltrados_btn" onclick="toggleVerMas('pagosFiltrados')">Ver más</button></td></tr>` : ''}
                  </tbody>
                  <tbody id="pagosFiltrados_full" style="display:none;">
                    ${full}
                    ${sorted.length > max ? `<tr><td colspan="4" style="text-align:center;"><button style="background:none;border:none;color:#2563eb;font-weight:700;cursor:pointer;padding:6px 0;" onclick="toggleVerMas('pagosFiltrados')">Ver menos</button></td></tr>` : ''}
                  </tbody>
                </table>
              </div>`;
        })()
      }
    </div>

    <div class="card reporte-seccion">
      <h3>💰 Préstamos activos y saldos</h3>
      ${prestamosActivos.length === 0
        ? `<div class="reporte-placeholder">No hay préstamos activos.</div>`
        : (() => {
            const max = 6;
            const preview = prestamosActivos.slice(0, max).map(p => {
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
                </tr>`;
            }).join('');
            const full = prestamosActivos.map(p => {
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
                </tr>`;
            }).join('');
            return `
              <div class="tabla-pagos-container">
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
                  <tbody id="prestamosActivos_preview">
                    ${preview}
                    ${prestamosActivos.length > max ? `<tr><td colspan="6" style="text-align:center;"><button style="background:none;border:none;color:#2563eb;font-weight:700;cursor:pointer;padding:6px 0;" id="prestamosActivos_btn" onclick="toggleVerMas('prestamosActivos')">Ver más</button></td></tr>` : ''}
                  </tbody>
                  <tbody id="prestamosActivos_full" style="display:none;">
                    ${full}
                    ${prestamosActivos.length > max ? `<tr><td colspan="6" style="text-align:center;"><button style="background:none;border:none;color:#2563eb;font-weight:700;cursor:pointer;padding:6px 0;" onclick="toggleVerMas('prestamosActivos')">Ver menos</button></td></tr>` : ''}
                  </tbody>
                </table>
              </div>`;
        })()
      }
    </div>

    <div class="card reporte-seccion">
      <h3>💸 Gastos del período (${gastosFiltrados.length})</h3>
      ${gastosFiltrados.length === 0
        ? `<div class="reporte-placeholder">No hay gastos registrados en este período.</div>`
        : `<div>
            <div style="margin-bottom:12px;padding:10px;background:#fff3cd;border-radius:8px;border:1px solid #ffc107;">
              <strong style="color:#856404;">Total gastos:</strong> <span style="font-weight:700;color:#856404;">${formatearMoneda(totalGastos)}</span>
            </div>
            <div class="tabla-pagos-container">
              <table>
                <thead>
                  <tr>
                    <th>Descripción</th>
                    <th>Categoría</th>
                    <th>Valor</th>
                    <th>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  ${gastosFiltrados
                    .sort((a, b) => normalizarFecha(b.fecha).localeCompare(normalizarFecha(a.fecha)))
                    .map(g => `
                      <tr>
                        <td>${g.descripcion || '-'}</td>
                        <td>${g.categoria || '-'}</td>
                        <td>${formatearMoneda(g.valor)}</td>
                        <td>${formatearFecha(normalizarFecha(g.fecha))}</td>
                      </tr>
                    `).join('')}
                </tbody>
              </table>
            </div>
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

// Alterna entre vista previa y vista completa para secciones largas
window.toggleVerMas = function(prefix) {
  try {
    const preview = document.getElementById(prefix + '_preview');
    const full    = document.getElementById(prefix + '_full');
    const btn     = document.getElementById(prefix + '_btn');
    if (!preview || !full) return;
    const showingPreview = preview.style.display !== 'none';
    if (showingPreview) {
      preview.style.display = 'none';
      full.style.display = '';
      if (btn) btn.style.display = 'none';
    } else {
      preview.style.display = '';
      full.style.display = 'none';
      if (btn) btn.style.display = '';
    }
  } catch (e) {
    console.error('toggleVerMas error', e);
  }
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
  iniciarReinicioDiario();
});