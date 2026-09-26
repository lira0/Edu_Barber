document.addEventListener("DOMContentLoaded", loadMyAppointments);

async function loadMyAppointments() {
  const statusBox = document.getElementById("myBookingsStatus");
  const upcoming = document.getElementById("upcomingBookings");
  const past = document.getElementById("pastBookings");

  if (!window.sb) {
    statusBox.innerHTML = '<div class="status-card error">Supabase não configurado.</div>';
    return;
  }

  const { data: sessionData } = await window.sb.auth.getSession();
  const user = sessionData.session?.user;

  if (!user) {
    upcoming.innerHTML = `
      <div class="login-required-card">
        <strong>Entre na sua conta</strong>
        <p>Os agendamentos feitos enquanto você está logado aparecem aqui.</p>
        <a class="primary-btn" href="./login.html">Entrar</a>
      </div>`;
    document.getElementById("pastSection").classList.add("hidden");
    return;
  }

  const { data, error } = await window.sb.rpc("my_appointments");
  if (error) {
    console.error(error);
    upcoming.innerHTML = '<div class="empty-state">Não foi possível carregar seus agendamentos.</div>';
    return;
  }

  const rows = data || [];
  const now = new Date();

  const futureRows = rows.filter(row => appointmentDate(row) >= now && !["completed","cancelled","no_show"].includes(row.status));
  const pastRows = rows.filter(row => !futureRows.includes(row));

  upcoming.innerHTML = futureRows.length
    ? futureRows.map(bookingCard).join("")
    : '<div class="empty-state">Você não tem nenhum próximo agendamento.</div>';

  past.innerHTML = pastRows.length
    ? pastRows.map(bookingCard).join("")
    : '<div class="empty-state">Seu histórico ainda está vazio.</div>';
}

function appointmentDate(row) {
  const d = String(row.appointment_date || "");
  const t = String(row.appointment_time || "00:00").slice(0,5);
  return new Date(`${d}T${t}:00`);
}

function bookingCard(row) {
  const date = appointmentDate(row);
  const day = new Intl.DateTimeFormat("pt-BR", { day:"2-digit", month:"short" }).format(date).replace(".", "");
  const time = String(row.appointment_time || "").slice(0,5);
  const statusLabels = {
    pending:"Pendente",
    confirmed:"Confirmado",
    completed:"Concluído",
    cancelled:"Cancelado",
    no_show:"Não compareceu"
  };

  return `
    <article class="my-booking-card">
      <div class="my-booking-time">
        <strong>${esc(time)}</strong>
        <span>${esc(day)}</span>
      </div>
      <div class="my-booking-info">
        <strong>${esc(row.service_name || "Atendimento")}</strong>
        <span>Com ${esc(row.barber_name || "Barbeiro")}</span>
        <small>${esc(new Intl.DateTimeFormat("pt-BR", { weekday:"long", day:"2-digit", month:"long" }).format(date))}</small>
      </div>
      <span class="status-pill status-${esc(row.status)}">${esc(statusLabels[row.status] || row.status)}</span>
    </article>`;
}

function esc(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}
