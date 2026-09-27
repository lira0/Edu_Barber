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

  const [y,m,d] = String(dateKey).split("-").map(Number);

  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(new Date(y, m - 1, d));
}

function compactDate(dateKey) {
  if (!dateKey) return "—";

  const [y,m,d] = String(dateKey).split("-").map(Number);

  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short"
  }).format(new Date(y, m - 1, d));
}

function phoneDisplay(phone) {
  const d = String(phone || "").replace(/\D/g, "").replace(/^55/, "");

  if (d.length === 11) {
    return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  }

  if (d.length === 10) {
    return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  }

  return phone || "—";
}

function waPhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function setInlineStatus(message, error = false) {
  const el = document.getElementById("adminStatus");
  if (!el) return;

  el.textContent = message || "";
  el.classList.toggle("error", Boolean(error));
}

async function getCurrentProfile() {
  const { data: sessionData } = await window.sb.auth.getSession();
  const user = sessionData.session?.user;

  if (!user) {
    return { user: null, profile: null };
  }

  const { data: profile, error } = await window.sb
    .from("profiles")
    .select("id, full_name, phone, role")
    .eq("id", user.id)
    .single();

  if (error) throw error;

  return { user, profile };
}

/* =========================================================
   LOGIN DO PAINEL
   ========================================================= */

adminLoginForm?.addEventListener("submit", async event => {
  event.preventDefault();

  if (!window.sb) {
    adminMessage(
      adminLoginStatus,
      "Configure o Supabase em config.js primeiro.",
      "error"
    );
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
        "Esta conta não tem permissão para acessar o painel.",
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

    adminMessage(
      adminLoginStatus,
      "Não foi possível validar a permissão da conta.",
      "error"
    );
  }
});

/* =========================================================
   PAINEL
   ========================================================= */

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
  const dateWrap = document.getElementById("adminDateWrap");
  const viewMode = document.getElementById("adminViewMode");
  const statusFilter = document.getElementById("adminStatusFilter");

  const barberFilterWrap = document.getElementById("adminBarberFilterWrap");
  const barberFilter = document.getElementById("adminBarberFilter");

  const list = document.getElementById("appointmentsList");

  const reminderCount = document.getElementById("reminderCount");
  const reminderSettingsStatus =
    document.getElementById("reminderSettingsStatus");

  document.getElementById("adminUserName").textContent =
    profile.full_name || user.email || "Barbeiro";

  document.getElementById("adminUserRole").textContent =
    profile.role === "admin"
      ? "Administrador"
      : "Barbeiro";

  dateInput.value = localDateKey();

  /* ---------------------------------------------------------
     Carrega barbeiros autorizados pela RPC.
     Para barber: somente o próprio perfil.
     Para admin: todos.
     --------------------------------------------------------- */

  const { data: allowedBarbers, error: barbersError } =
    await window.sb.rpc("barber_dashboard_barbers");

  if (barbersError) {
    console.error(barbersError);

    list.innerHTML = `
      <div class="empty-state">
        Não foi possível carregar o vínculo da conta com o barbeiro.
      </div>
    `;

    setInlineStatus(
      barbersError.message || "Falha ao carregar o barbeiro.",
      true
    );

    return;
  }

  const barbers = allowedBarbers || [];

  if (!barbers.length) {
    list.innerHTML = `
      <div class="empty-state">
        Sua conta tem permissão de barbeiro, mas não existe um perfil de profissional
        vinculado a ela. Execute novamente o patch SQL desta atualização.
      </div>
    `;
    return;
  }

  if (profile.role === "admin") {
    barberFilterWrap.classList.remove("hidden");
    barberFilter.innerHTML = `<option value="">Todos os barbeiros</option>`;

    barbers.forEach(barber => {
      barberFilter.insertAdjacentHTML(
        "beforeend",
        `<option value="${html(barber.barber_id)}">${html(barber.display_name)}</option>`
      );
    });
  } else {
    barberFilterWrap.classList.add("hidden");
  }

  const ownBarber = profile.role === "barber"
    ? barbers[0]
    : null;

  document.getElementById("adminSubtitle").textContent =
    profile.role === "admin"
      ? "Acompanhe os horários registrados no Supabase."
      : `Agenda de ${ownBarber?.display_name || profile.full_name || "barbeiro"}.`;

  function selectedBarberId() {
    if (profile.role === "barber") {
      return ownBarber?.barber_id || null;
    }

    return barberFilter.value || null;
  }

  /* =========================================================
     CONFIGURAÇÃO DOS LEMBRETES AUTOMÁTICOS
     ========================================================= */

  async function loadReminderSettings() {
    const barberId = selectedBarberId();

    if (profile.role === "admin" && !barberId) {
      reminderCount.disabled = true;
      document.getElementById("saveReminderSettings").disabled = true;

      reminderSettingsStatus.textContent =
        "Selecione um barbeiro para alterar a configuração.";

      return;
    }

    reminderCount.disabled = false;
    document.getElementById("saveReminderSettings").disabled = false;
    reminderSettingsStatus.textContent = "Carregando...";

    const { data, error } = await window.sb.rpc(
      "barber_get_reminder_settings",
      {
        p_barber_id: barberId
      }
    );

    if (error) {
      console.error(error);
      reminderSettingsStatus.textContent =
        "Não foi possível carregar a configuração.";
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;

    reminderCount.value = String(row?.automatic_reminder_count ?? 2);
    reminderSettingsStatus.textContent =
      "Configuração carregada.";
  }

  document.getElementById("saveReminderSettings")
    .addEventListener("click", async () => {
      const barberId = selectedBarberId();
      const count = Number(reminderCount.value);

      if (profile.role === "admin" && !barberId) {
        reminderSettingsStatus.textContent =
          "Selecione um barbeiro primeiro.";
        return;
      }

      const button = document.getElementById("saveReminderSettings");
      button.disabled = true;
      button.textContent = "Salvando...";
      reminderSettingsStatus.textContent = "";

      const { data, error } = await window.sb.rpc(
        "barber_set_reminder_count",
        {
          p_count: count,
          p_barber_id: barberId
        }
      );

      button.disabled = false;
      button.textContent = "Salvar lembretes";

      if (error) {
        console.error(error);
        reminderSettingsStatus.textContent =
          error.message || "Não foi possível salvar.";
        return;
      }

      reminderSettingsStatus.textContent =
        `Salvo: ${data} lembrete(s) automático(s) por agendamento.`;

      await loadAppointments();
    });

  /* =========================================================
     AGENDA
     ========================================================= */

  function updateViewControls() {
    const isDate = viewMode.value === "date";
    dateWrap.classList.toggle("hidden", !isDate);
  }

  async function fetchAppointments(statusOverride) {
    const mode = viewMode.value;

    const payload = {
      p_date: mode === "date" ? dateInput.value : null,
      p_upcoming: mode === "upcoming",
      p_status:
        statusOverride === undefined
          ? (statusFilter.value === "all" ? null : statusFilter.value)
          : statusOverride,
      p_barber_id: selectedBarberId()
    };

    const { data, error } = await window.sb.rpc(
      "barber_dashboard_appointments",
      payload
    );

    if (error) throw error;

    return data || [];
  }

  async function loadAppointments() {
    list.innerHTML =
      `<div class="empty-state">Carregando agenda...</div>`;

    setInlineStatus("");

    try {
      const rows = await fetchAppointments();

      const title =
        viewMode.value === "upcoming"
          ? "Próximos agendamentos"
          : brDate(dateInput.value);

      document.getElementById("agendaDateTitle").textContent = title;
      document.getElementById("agendaCount").textContent =
        `${rows.length} ${rows.length === 1 ? "cliente" : "clientes"}`;

      // Estatísticas sem aplicar filtro de status.
      const statRows = await fetchAppointments(null);

      document.getElementById("statTotal").textContent =
        statRows.length;

      document.getElementById("statConfirmed").textContent =
        statRows.filter(row =>
          row.status === "confirmed" || row.status === "pending"
        ).length;

      document.getElementById("statCompleted").textContent =
        statRows.filter(row => row.status === "completed").length;

      document.getElementById("statCancelled").textContent =
        statRows.filter(row =>
          row.status === "cancelled" || row.status === "no_show"
        ).length;

      if (!rows.length) {
        list.innerHTML = `
          <div class="empty-state">
            Nenhum cliente encontrado para os filtros selecionados.
          </div>
        `;
        return;
      }

      list.innerHTML = rows.map(row => {
        const time = String(row.appointment_time || "").slice(0, 5);
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
          <article class="appointment-card" data-id="${html(row.appointment_id)}">

            <div class="appointment-time">
              <strong>${html(time)}</strong>
              <span>${html(compactDate(row.appointment_date))}</span>
            </div>

            <div class="appointment-client">
              <div class="appointment-avatar">
                ${html((row.customer_name || "?").charAt(0).toUpperCase())}
              </div>

              <div>
                <strong>${html(row.customer_name)}</strong>
                <span>${html(phone)}</span>

                <small>
                  ${html(row.service_name || "Atendimento")}
                  ${profile.role === "admin"
                    ? ` • ${html(row.barber_name || "")}`
                    : ""}
                </small>
              </div>
            </div>

            <div class="appointment-status-wrap">
              <span class="status-pill status-${html(row.status)}">
                ${html(statusLabels[row.status] || row.status)}
              </span>

              <span class="reminder-chip">
                🔔 ${Number(row.sent_reminders || 0)} enviado(s)
                • ${Number(row.pending_reminders || 0)} pendente(s)
              </span>
            </div>

            <div class="appointment-actions">
              <button
                class="small-action reminder-action"
                data-reminder-now
                type="button">
                🔔 Enviar lembrete agora
              </button>

              <a
                class="small-action"
                href="https://wa.me/${html(wa)}"
                target="_blank"
                rel="noopener">
                Abrir WhatsApp
              </a>

              <button
                class="small-action success"
                data-action="completed"
                type="button">
                Concluir
              </button>

              <button
                class="small-action"
                data-action="confirmed"
                type="button">
                Confirmar
              </button>

              <button
                class="small-action danger"
                data-action="cancelled"
                type="button">
                Cancelar
              </button>
            </div>

          </article>
        `;
      }).join("");

      bindAppointmentActions();

    } catch (error) {
      console.error(error);

      list.innerHTML = `
        <div class="empty-state">
          Erro ao carregar os agendamentos.
        </div>
      `;

      setInlineStatus(
        error.message || "Falha ao carregar a agenda.",
        true
      );
    }
  }

  function bindAppointmentActions() {
    list.querySelectorAll("[data-action]").forEach(button => {
      button.addEventListener("click", async () => {
        const card = button.closest(".appointment-card");
        const appointmentId = card.dataset.id;
        const newStatus = button.dataset.action;

        button.disabled = true;

        const { error } = await window.sb.rpc(
          "barber_update_appointment_status",
          {
            p_appointment_id: appointmentId,
            p_status: newStatus
          }
        );

        if (error) {
          console.error(error);
          setInlineStatus(
            error.message || "Não foi possível atualizar o atendimento.",
            true
          );
          button.disabled = false;
          return;
        }

        setInlineStatus("Status atualizado.");
        await loadAppointments();
      });
    });

    list.querySelectorAll("[data-reminder-now]").forEach(button => {
      button.addEventListener("click", async () => {
        const card = button.closest(".appointment-card");
        const appointmentId = card.dataset.id;

        button.disabled = true;
        const oldText = button.textContent;
        button.textContent = "Enfileirando...";

        const { error } = await window.sb.rpc(
          "barber_queue_manual_reminder",
          {
            p_appointment_id: appointmentId
          }
        );

        button.disabled = false;
        button.textContent = oldText;

        if (error) {
          console.error(error);

          const raw = String(error.message || "");

          if (raw.includes("MANUAL_REMINDER_ALREADY_QUEUED")) {
            setInlineStatus(
              "Já existe um lembrete manual aguardando envio para este cliente.",
              true
            );
            return;
          }

          setInlineStatus(
            raw || "Não foi possível enfileirar o lembrete.",
            true
          );
          return;
        }

        setInlineStatus(
          "Lembrete manual colocado na fila. O celular de automação deverá enviá-lo no próximo polling."
        );

        await loadAppointments();
      });
    });
  }

  updateViewControls();
  await loadReminderSettings();
  await loadAppointments();

  viewMode.addEventListener("change", async () => {
    updateViewControls();
    await loadAppointments();
  });

  dateInput.addEventListener("change", loadAppointments);
  statusFilter.addEventListener("change", loadAppointments);

  barberFilter?.addEventListener("change", async () => {
    await loadReminderSettings();
    await loadAppointments();
  });

  document.getElementById("refreshAppointments")
    .addEventListener("click", async () => {
      await loadReminderSettings();
      await loadAppointments();
    });

  document.getElementById("adminLogout")
    .addEventListener("click", async () => {
      await window.sb.auth.signOut();
      window.location.href = "./admin-login.html";
    });
}

initAdmin();
