import { db, logout, onAuthChange } from "./firebase.js";
import {
  collection,
  query,
  where,
  getDocs,
  setDoc,
  doc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let gastos = [];
let userId = null;
let terminoBusqueda = "";

const CATEGORIAS = [
  "Transporte",
  "Alimentación",
  "Servicios",
  "Oficina",
  "Comunicaciones",
  "Mantenimiento",
  "Otros"
];

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

function formatearFecha(f) {
  if (!f) return '-';
  const [y, m, d] = f.split('-');
  return `${d}/${m}/${y}`;
}

function formatearMoneda(v) {
  return '$' + Number(v || 0).toLocaleString('es-CO');
}

onAuthChange(async user => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  userId = user.uid;
  const emailEl = document.getElementById("usuarioEmail");
  if (emailEl) emailEl.textContent = user.email || "";

  const logoutBtn = document.getElementById("logoutButton");
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      await logout();
      window.location.href = "login.html";
    };
  }

  // Poblar select de categorías
  const selectCat = document.getElementById("gastoCategoria");
  if (selectCat) {
    CATEGORIAS.forEach(cat => {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      selectCat.appendChild(opt);
    });
  }

  // Fecha por defecto = hoy
  const fechaInput = document.getElementById("gastoFecha");
  if (fechaInput) fechaInput.value = fechaLocal();

  await cargarGastos();
  renderGastos();
});

async function cargarGastos() {
  if (!userId) return;
  const consulta = query(
    collection(db, "gastos"),
    where("userId", "==", userId)
  );
  const snapshot = await getDocs(consulta);
  gastos = snapshot.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => normalizarFecha(b.fecha).localeCompare(normalizarFecha(a.fecha)));
}

window.guardarGasto = async function() {
  const descripcion = document.getElementById("gastoDescripcion").value.trim();
  const valor       = parseFloat(document.getElementById("gastoValor").value);
  const categoria   = document.getElementById("gastoCategoria").value;
  const fecha       = document.getElementById("gastoFecha").value;
  const nota        = document.getElementById("gastoNota").value.trim();

  if (!descripcion) { alert("La descripción es obligatoria."); return; }
  if (!valor || valor <= 0) { alert("Ingresa un valor válido mayor a 0."); return; }
  if (!fecha) { alert("Selecciona una fecha."); return; }

  const id = Date.now().toString();
  const gasto = { descripcion, valor, categoria, fecha, nota, userId };

  console.log('Guardando gasto:', gasto);
  await setDoc(doc(db, "gastos", id), gasto);
  console.log('Gasto guardado con ID:', id);

  // Limpiar formulario
  document.getElementById("gastoDescripcion").value = "";
  document.getElementById("gastoValor").value = "";
  document.getElementById("gastoNota").value = "";
  document.getElementById("gastoFecha").value = fechaLocal();
  document.getElementById("gastoCategoria").selectedIndex = 0;

  ocultarNuevoGasto();

  await cargarGastos();
  renderGastos();
  mostrarToast("✅ Gasto guardado correctamente");
};

window.eliminarGasto = async function(id) {
  const confirmar = confirm(
    "⚠️ ¿Seguro que deseas eliminar este gasto?\nEsta acción no se puede deshacer."
  );
  if (!confirmar) return;

  try {
    await deleteDoc(doc(db, "gastos", id));
    gastos = gastos.filter(g => g.id !== id);
    renderGastos();
    mostrarToast("🗑️ Gasto eliminado");
  } catch (e) {
    console.error(e);
    alert("❌ Error al eliminar el gasto");
  }
};

window.buscarGastos = function() {
  terminoBusqueda = document.getElementById("buscarGasto").value;
  renderGastos();
};

window.toggleNuevoGasto = function() {
  document.getElementById("nuevoGastoCard").classList.toggle("hidden");
};

window.ocultarNuevoGasto = function() {
  document.getElementById("nuevoGastoCard").classList.add("hidden");
};

function renderGastos() {
  const cont = document.getElementById("listaGastos");
  const totalEl = document.getElementById("totalGastos");
  if (!cont) return;

  const filtro = terminoBusqueda.trim().toLowerCase();
  const lista = gastos.filter(g => {
    if (!filtro) return true;
    return (
      g.descripcion.toLowerCase().includes(filtro) ||
      (g.categoria || "").toLowerCase().includes(filtro)
    );
  });

  const total = lista.reduce((s, g) => s + Number(g.valor || 0), 0);
  if (totalEl) totalEl.textContent = formatearMoneda(total);

  if (lista.length === 0) {
    cont.innerHTML = `<div class="placeholder">No se encontraron gastos</div>`;
    return;
  }

  // Agrupar por fecha
  const porFecha = {};
  lista.forEach(g => {
    const f = normalizarFecha(g.fecha);
    if (!porFecha[f]) porFecha[f] = [];
    porFecha[f].push(g);
  });

  const fechasOrdenadas = Object.keys(porFecha).sort((a, b) => b.localeCompare(a));

  cont.innerHTML = fechasOrdenadas.map(fecha => {
    const items = porFecha[fecha];
    const subtotal = items.reduce((s, g) => s + Number(g.valor || 0), 0);

    return `
      <div class="gasto-grupo">
        <div class="gasto-fecha-header">
          <span>${formatearFecha(fecha)}</span>
          <span class="gasto-subtotal">${formatearMoneda(subtotal)}</span>
        </div>
        ${items.map(g => `
          <div class="gasto-item">
            <div class="gasto-icono">${iconoCategoria(g.categoria)}</div>
            <div class="gasto-info">
              <strong>${g.descripcion}</strong>
              <span class="gasto-categoria">${g.categoria || 'Sin categoría'}</span>
              ${g.nota ? `<span class="gasto-nota">${g.nota}</span>` : ''}
            </div>
            <div class="gasto-derecha">
              <div class="gasto-valor">${formatearMoneda(g.valor)}</div>
              <button class="btn-danger small" onclick="eliminarGasto('${g.id}')">Eliminar</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }).join('');
}

function iconoCategoria(cat) {
  const iconos = {
    "Transporte": "🚗",
    "Alimentación": "🍽️",
    "Servicios": "💡",
    "Oficina": "🖊️",
    "Comunicaciones": "📱",
    "Mantenimiento": "🔧",
    "Otros": "📦"
  };
  return iconos[cat] || "💸";
}

function mostrarToast(msg) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), 2800);
}