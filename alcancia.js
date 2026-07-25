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

let alcancias = [];
let userId = null;
let terminoBusquedaAlcancia = "";

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
  if (typeof fecha === 'string') return fecha.slice(0, 10);
  if (fecha instanceof Date) return fechaLocal(fecha);
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

  const fechaAlcanciaInput = document.getElementById("alcanciaFecha");
  if (fechaAlcanciaInput) fechaAlcanciaInput.value = fechaLocal();

  await cargarAlcancias();
  renderAlcancias();
});

async function cargarAlcancias() {
  if (!userId) return;
  const consulta = query(
    collection(db, "alcancias"),
    where("userId", "==", userId)
  );
  const snapshot = await getDocs(consulta);
  alcancias = snapshot.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => normalizarFecha(b.fecha).localeCompare(normalizarFecha(a.fecha)));
}

window.guardarAlcancia = async function() {
  const descripcion = document.getElementById("alcanciaDescripcion").value.trim();
  const valor = parseFloat(document.getElementById("alcanciaValor").value);
  const fecha = document.getElementById("alcanciaFecha").value;
  const nota = document.getElementById("alcanciaNota").value.trim();

  if (!descripcion) { alert("La descripción es obligatoria."); return; }
  if (!valor || valor <= 0) { alert("Ingresa un valor válido mayor a 0."); return; }
  if (!fecha) { alert("Selecciona una fecha."); return; }

  const id = Date.now().toString();
  const pagoAlcancia = { descripcion, valor, fecha, nota, userId };

  await setDoc(doc(db, "alcancias", id), pagoAlcancia);

  document.getElementById("alcanciaDescripcion").value = "";
  document.getElementById("alcanciaValor").value = "";
  document.getElementById("alcanciaNota").value = "";
  document.getElementById("alcanciaFecha").value = fechaLocal();

  ocultarNuevaAlcancia();

  await cargarAlcancias();
  renderAlcancias();
  mostrarToast("✅ Ingreso de alcancía guardado correctamente");
};

window.eliminarAlcancia = async function(id) {
  const confirmar = confirm(
    "⚠️ ¿Seguro que deseas eliminar este ingreso de alcancía?\nEsta acción no se puede deshacer."
  );
  if (!confirmar) return;

  try {
    await deleteDoc(doc(db, "alcancias", id));
    alcancias = alcancias.filter(a => a.id !== id);
    renderAlcancias();
    mostrarToast("🗑️ Ingreso de alcancía eliminado");
  } catch (e) {
    console.error(e);
    alert("❌ Error al eliminar el ingreso de alcancía");
  }
};

window.buscarAlcancias = function() {
  terminoBusquedaAlcancia = document.getElementById("buscarAlcancia").value;
  renderAlcancias();
};

window.toggleNuevaAlcancia = function() {
  document.getElementById("nuevoAlcanciaCard").classList.toggle("hidden");
};

window.ocultarNuevaAlcancia = function() {
  document.getElementById("nuevoAlcanciaCard").classList.add("hidden");
};

function renderAlcancias() {
  const cont = document.getElementById("listaAlcancias");
  const totalEl = document.getElementById("totalAlcancias");
  if (!cont) return;

  const filtro = terminoBusquedaAlcancia.trim().toLowerCase();
  const lista = alcancias.filter(a => {
    if (!filtro) return true;
    return a.descripcion.toLowerCase().includes(filtro);
  });

  const total = lista.reduce((s, a) => s + Number(a.valor || 0), 0);
  if (totalEl) totalEl.textContent = formatearMoneda(total);

  if (lista.length === 0) {
    cont.innerHTML = `<div class="placeholder">No se encontraron ingresos de alcancía</div>`;
    return;
  }

  const porFecha = {};
  lista.forEach(a => {
    const f = normalizarFecha(a.fecha);
    if (!porFecha[f]) porFecha[f] = [];
    porFecha[f].push(a);
  });

  const fechasOrdenadas = Object.keys(porFecha).sort((a, b) => b.localeCompare(a));

  cont.innerHTML = fechasOrdenadas.map(fecha => {
    const items = porFecha[fecha];
    const subtotal = items.reduce((s, a) => s + Number(a.valor || 0), 0);

    return `
      <div class="gasto-grupo">
        <div class="gasto-fecha-header">
          <span>${formatearFecha(fecha)}</span>
          <span class="gasto-subtotal">${formatearMoneda(subtotal)}</span>
        </div>
        ${items.map(a => `
          <div class="gasto-item">
            <div class="gasto-icono">🐷</div>
            <div class="gasto-info">
              <strong>${a.descripcion}</strong>
              ${a.nota ? `<span class="gasto-nota">${a.nota}</span>` : ''}
            </div>
            <div class="gasto-derecha">
              <div class="gasto-valor">${formatearMoneda(a.valor)}</div>
              <button class="btn-danger small" onclick="eliminarAlcancia('${a.id}')">Eliminar</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }).join('');
}

function mostrarToast(msg) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), 2800);
}
