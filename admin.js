const adminLoginForm = document.getElementById("adminLoginForm");
const adminLoginStatus = document.getElementById("adminLoginStatus");
const adminApp = document.getElementById("adminApp");

function adminMessage(el, message, type = "info") {
  if (!el) return;
  el.textContent = message;
  el.className = `auth-status ${type}`;
}

function html(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function localDateKey(date = new Date()) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
}

function brDate(dateKey) {
  if (!dateKey) return "—";
  const [y,m,d] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(new Date(y, m - 1, d));
}

function phoneDisplay(phone) {
  const d = String(phone || "").replace(/\D/g, "").replace(/^55/, "");
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return phone || "—";
}

function waPhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

async function getCurrentProfile() {
  const { data: sessionData } = await window.sb.auth.getSession();
  const user = sessionData.session?.user;
  if (!user) return { user: null, profile: null };

  const { data: profile, error } = await window.sb
    .from("profiles")
    .select("id, full_name, phone, role")
    .eq("id", user.id)
    .single();

  if (error) throw error;
  return { user, profile };
}

adminLoginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!window.sb) {
    adminMessage(adminLoginStatus, "Configure o Supabase em config.js primeiro.", "error");
    return;
  }

  const email = document.getElementById("adminEmail").value.trim().toLowerCase();
  const password = document.getElementById("adminPassword").value;
  const button = adminLoginForm.querySelector('button[type="submit"]');

  button.disabled = true;
  button.textContent = "Entrando...";
  adminMessage(adminLoginStatus, "Validando acesso...", "info");

  const { error: loginError } = await window.sb.auth.signInWithPassword({
    email,
    password
  });

  if (loginError) {
    button.disabled = false;
    button.textContent = "Entrar no painel";
    adminMessage(adminLoginStatus, "Usuário ou senha inválidos.", "error");
    return;
  }

  try {
    const { profile } = await getCurrentProfile();

    if (!profile || !["barber", "admin"].includes(profile.role)) {
      await window.sb.auth.signOut();
      button.disabled = false;
      button.textContent = "Entrar no painel";
      adminMessage(
        adminLoginStatus,
        "Esta conta não tem permissão para acessar o painel do barbeiro.",
        "error"
      );
      return;
    }

    adminMessage(adminLoginStatus, "Acesso autorizado.", "success");
    window.location.href = "./admin.html";
  } catch (error) {
    console.error(error);
    await window.sb.auth.signOut();
    button.disabled = false;
    button.textContent = "Entrar no painel";
    adminMessage(adminLoginStatus, "Não foi possível validar a permissão da conta.", "error");
  }
});

async function initAdmin() {
  if (!adminApp) return;

  if (!window.sb) {
    window.location.replace("./admin-login.html");
    return;
  }

  let profileInfo;
  try {
    profileInfo = await getCurrentProfile();
  } catch (error) {
    console.error(error);
    window.location.replace("./admin-login.html");
    return;
  }

  const { user, profile } = profileInfo;

  if (!user || !profile || !["barber", "admin"].includes(profile.role)) {
    await window.sb.auth.signOut();
    window.location.replace("./admin-login.html");
    return;
  }

  const dateInput = document.getElementById("adminDate");
  const statusFilter = document.getElementById("adminStatusFilter");
  const barberFilterWrap = document.getElementById("adminBarberFilterWrap");
  const barberFilter = document.getElementById("adminBarberFilter");
  const list = document.getElementById("appointmentsList");
  const inlineStatus = document.getElementById("adminStatus");

  document.getElementById("adminUserName").textContent =
    profile.full_name || user.email || "Barbeiro";
  document.getElementById("adminUserRole").textContent =
    profile.role === "admin" ? "Administrador" : "Barbeiro";

  dateInput.value = localDateKey();

  let myBarbers = [];

  const { data: barberRows, error: barberError } = await window.sb
    .from("barbers")
    .select("id, display_name, active")
    .order("display_name");

  if (barberError) {
    console.error(barberError);
    inlineStatus.textContent = "Não foi possível carregar o perfil do barbeiro.";
    return;
  }

  myBarbers = barberRows || [];

  if (!myBarbers.length) {
    list.innerHTML = `
      <div class="empty-state">
        Sua conta está autorizada, mas ainda não há um perfil de barbeiro vinculado.
        Execute a função <code>promote_user_to_barber</code> no SQL Editor conforme o README.
      </div>`;
    return;
  }

  if (profile.role === "admin" && myBarbers.length > 1) {
    barberFilterWrap.classList.remove("hidden");
    barberFilter.innerHTML = `<option value="all">Todos os barbeiros</option>`;
    myBarbers.forEach(b => {
      barberFilter.insertAdjacentHTML(
        "beforeend",
        `<option value="${html(b.id)}">${html(b.display_name)}</option>`
      );
    });
  }

  document.getElementById("adminSubtitle").textContent =
    profile.role === "admin"
      ? "Visão administrativa dos horários registrados no Supabase."
      : `Agenda de ${myBarbers[0].display_name}.`;

  async function loadAppointments() {
    const date = dateInput.value;
    const status = statusFilter.value;
    const selectedBarberId = barberFilter?.value || myBarbers[0]?.id;

    list.innerHTML = `<div class="empty-state">Carregando agenda...</div>`;
    inlineStatus.textContent = "";

    let query = window.sb
      .from("appointments")
      .select(`
        id,
        customer_name,
        phone,
        appointment_date,
        appointment_time,
        reminder_consent,
        status,
        created_at,
        barber_id,
        service_id,
        barbers(display_name),
        services(name, duration_minutes, price)
      `)
      .eq("appointment_date", date)
      .order("appointment_time", { ascending: true });

    if (profile.role !== "admin") {
      query = query.in("barber_id", myBarbers.map(b => b.id));
    } else if (selectedBarberId && selectedBarberId !== "all") {
      query = query.eq("barber_id", selectedBarberId);
    }

    if (status !== "all") {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) {
      console.error(error);
      list.innerHTML = `<div class="empty-state">Erro ao carregar os agendamentos.</div>`;
      inlineStatus.textContent = error.message || "Falha na consulta.";
      return;
    }

    const rows = data || [];

    document.getElementById("agendaDateTitle").textContent = brDate(date);
    document.getElementById("agendaCount").textContent =
      `${rows.length} ${rows.length === 1 ? "cliente" : "clientes"}`;

    // Stats ignore current status filter: fetch day rows for current barber scope
    let statsQuery = window.sb
      .from("appointments")
      .select("status, barber_id")
      .eq("appointment_date", date);

    if (profile.role !== "admin") {
      statsQuery = statsQuery.in("barber_id", myBarbers.map(b => b.id));
    } else if (selectedBarberId && selectedBarberId !== "all") {
      statsQuery = statsQuery.eq("barber_id", selectedBarberId);
    }

    const { data: statsRows } = await statsQuery;
    const s = statsRows || [];

    document.getElementById("statTotal").textContent = s.length;
    document.getElementById("statConfirmed").textContent =
      s.filter(x => x.status === "confirmed" || x.status === "pending").length;
    document.getElementById("statCompleted").textContent =
      s.filter(x => x.status === "completed").length;
    document.getElementById("statCancelled").textContent =
      s.filter(x => x.status === "cancelled" || x.status === "no_show").length;

    if (!rows.length) {
      list.innerHTML = `<div class="empty-state">Nenhum cliente encontrado para os filtros selecionados.</div>`;
      return;
    }

    list.innerHTML = rows.map(row => {
      const time = String(row.appointment_time || "").slice(0,5);
      const serviceName = row.services?.name || "Atendimento";
      const barberName = row.barbers?.display_name || "Barbeiro";
      const phone = phoneDisplay(row.phone);
      const wa = waPhone(row.phone);

      const statusLabels = {
        pending: "Pendente",
        confirmed: "Confirmado",
        completed: "Concluído",
        cancelled: "Cancelado",
        no_show: "Não compareceu"
      };

      return `
        <article class="appointment-card" data-id="${html(row.id)}">
          <div class="appointment-time">
            <strong>${html(time)}</strong>
            <span>${html(serviceName)}</span>
          </div>

          <div class="appointment-client">
            <div class="appointment-avatar">${html((row.customer_name || "?").charAt(0).toUpperCase())}</div>
            <div>
              <strong>${html(row.customer_name)}</strong>
              <span>${html(phone)}</span>
              ${profile.role === "admin" ? `<small>${html(barberName)}</small>` : ""}
            </div>
          </div>

          <div class="appointment-status-wrap">
            <span class="status-pill status-${html(row.status)}">${html(statusLabels[row.status] || row.status)}</span>
            <span class="reminder-chip">${row.reminder_consent ? "🔔 lembrete ativo" : "🔕 sem lembrete"}</span>
          </div>

          <div class="appointment-actions">
            <a class="small-action" href="https://wa.me/${html(wa)}" target="_blank" rel="noopener">WhatsApp</a>
            <button class="small-action success" data-action="completed" type="button">Concluir</button>
            <button class="small-action" data-action="confirmed" type="button">Confirmar</button>
            <button class="small-action danger" data-action="cancelled" type="button">Cancelar</button>
          </div>
        </article>
      `;
    }).join("");

    list.querySelectorAll("[data-action]").forEach(button => {
      button.addEventListener("click", async () => {
        const card = button.closest(".appointment-card");
        const id = card.dataset.id;
        const newStatus = button.dataset.action;

        button.disabled = true;

        const { error: updateError } = await window.sb
          .from("appointments")
          .update({ status: newStatus })
          .eq("id", id);

        if (updateError) {
          console.error(updateError);
          inlineStatus.textContent = "Não foi possível atualizar o atendimento.";
          button.disabled = false;
          return;
        }

        await loadAppointments();
      });
    });
  }

  dateInput.addEventListener("change", loadAppointments);
  statusFilter.addEventListener("change", loadAppointments);
  barberFilter?.addEventListener("change", loadAppointments);
  document.getElementById("refreshAppointments").addEventListener("click", loadAppointments);

  document.getElementById("adminLogout").addEventListener("click", async () => {
    await window.sb.auth.signOut();
    window.location.href = "./admin-login.html";
  });

  await loadAppointments();
}

initAdmin();
