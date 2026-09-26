const CONFIG = window.BARBERSHOP_CONFIG;

const dateStrip = document.getElementById("dateStrip");
const timeGrid = document.getElementById("timeGrid");
const selectedDateLabel = document.getElementById("selectedDateLabel");
const clientStep = document.getElementById("clientStep");
const selectedSlotSummary = document.getElementById("selectedSlotSummary");
const bookingForm = document.getElementById("bookingForm");
const customerPhone = document.getElementById("customerPhone");
const bookingStatus = document.getElementById("bookingStatus");
const toast = document.getElementById("toast");
const confirmBookingBtn = document.getElementById("confirmBookingBtn");
const barberStep = document.getElementById("barberStep");
const barberGrid = document.getElementById("barberGrid");

let selectedDate = null;
let selectedTime = null;
let selectedBarber = null;
let availableBarbers = [];

document.getElementById("year").textContent = new Date().getFullYear();

document.getElementById("heroScheduleBtn").addEventListener("click", () => {
  document.getElementById("agendamento").scrollIntoView({ behavior: "smooth" });
});

function pad(n) {
  return String(n).padStart(2, "0");
}

function toLocalDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatLongDate(date) {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long"
  }).format(date);
}

function formatShortDate(date) {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short"
  }).format(date);
}

function minutesFromTime(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function timeFromMinutes(total) {
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function getSlotsForDate(date) {
  const schedule = CONFIG.OPENING_HOURS[date.getDay()];
  if (!schedule) return [];

  const start = minutesFromTime(schedule.open);
  const end = minutesFromTime(schedule.close);
  const slots = [];

  for (let value = start; value < end; value += CONFIG.SLOT_INTERVAL_MINUTES) {
    slots.push(timeFromMinutes(value));
  }
  return slots;
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function maskPhone(value) {
  const digits = normalizePhone(value).slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0,2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0,2)}) ${digits.slice(2,6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}`;
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.className = `toast show${isError ? " error" : ""}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.className = "toast";
  }, 4200);
}

function showBookingStatus(message, error = false) {
  bookingStatus.innerHTML = `
    <div class="status-card${error ? " error" : ""}">
      ${message}
    </div>
  `;
}

function requireSupabase() {
  if (window.sb) return true;
  showBookingStatus(
    "<strong>Supabase não configurado.</strong><br>Preencha a URL e a Publishable Key em <code>config.js</code>.",
    true
  );
  return false;
}

async function loadBarbers() {
  if (!requireSupabase()) return;

  const { data, error } = await window.sb.rpc("list_active_barbers");

  if (error) {
    console.error(error);
    showBookingStatus("Não foi possível carregar os profissionais disponíveis.", true);
    return;
  }

  availableBarbers = data || [];

  if (!availableBarbers.length) {
    showBookingStatus(
      "Nenhum barbeiro ativo foi cadastrado no Supabase. Cadastre a conta do barbeiro e execute a promoção descrita no README.",
      true
    );
    return;
  }

  if (availableBarbers.length === 1) {
    selectedBarber = availableBarbers[0];
    barberStep?.classList.add("hidden");

    const dateStepNumber = document.getElementById("dateStepNumber");
    const timeStepNumber = document.getElementById("timeStepNumber");
    const clientStepNumber = document.getElementById("clientStepNumber");

    if (dateStepNumber) dateStepNumber.textContent = "1";
    if (timeStepNumber) timeStepNumber.textContent = "2";
    if (clientStepNumber) clientStepNumber.textContent = "3";

    renderDates();
    return;
  }

  barberStep?.classList.remove("hidden");

  const dateStepNumber = document.getElementById("dateStepNumber");
  const timeStepNumber = document.getElementById("timeStepNumber");
  const clientStepNumber = document.getElementById("clientStepNumber");

  if (dateStepNumber) dateStepNumber.textContent = "2";
  if (timeStepNumber) timeStepNumber.textContent = "3";
  if (clientStepNumber) clientStepNumber.textContent = "4";

  if (!barberGrid) {
    showBookingStatus("Erro de interface: seletor de profissionais não encontrado.", true);
    return;
  }

  barberGrid.innerHTML = "";
  availableBarbers.forEach(barber => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "barber-btn";
    button.innerHTML = `<span>💈</span><strong>${escapeHtml(barber.display_name)}</strong>`;
    button.addEventListener("click", () => {
      document.querySelectorAll(".barber-btn").forEach(btn => btn.classList.remove("active"));
      button.classList.add("active");
      selectedBarber = barber;
      selectedDate = null;
      selectedTime = null;
      clientStep.classList.add("hidden");
      renderDates();
      document.getElementById("dateStrip").scrollIntoView({ behavior: "smooth", block: "center" });
    });
    barberGrid.appendChild(button);
  });

  dateStrip.innerHTML = `<div class="empty-state">Escolha um profissional primeiro.</div>`;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function renderDates() {
  if (!selectedBarber) return;

  dateStrip.innerHTML = "";

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let rendered = 0;
  let offset = 0;

  while (rendered < CONFIG.DAYS_TO_SHOW && offset < 40) {
    const date = new Date(today);
    date.setDate(today.getDate() + offset);
    offset++;

    if (!CONFIG.OPENING_HOURS[date.getDay()]) continue;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "date-btn";
    btn.dataset.date = toLocalDateKey(date);

    const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "short" })
      .format(date).replace(".", "");

    const month = new Intl.DateTimeFormat("pt-BR", { month: "short" })
      .format(date).replace(".", "");

    btn.innerHTML = `
      <span class="weekday">${weekday}</span>
      <span class="day">${pad(date.getDate())}</span>
      <span class="month">${month}</span>
    `;

    btn.addEventListener("click", () => selectDate(date, btn));
    dateStrip.appendChild(btn);
    rendered++;
  }
}

async function selectDate(date, button) {
  if (!selectedBarber) {
    showToast("Escolha o profissional primeiro.", true);
    return;
  }

  selectedDate = new Date(date);
  selectedTime = null;
  clientStep.classList.add("hidden");
  bookingStatus.innerHTML = "";

  document.querySelectorAll(".date-btn").forEach(btn => btn.classList.remove("active"));
  button.classList.add("active");

  selectedDateLabel.textContent = `${formatLongDate(selectedDate)} • ${selectedBarber.display_name}`;
  await renderTimes();
}

async function getBookedTimes(dateKey) {
  const { data, error } = await window.sb.rpc("get_booked_times", {
    p_date: dateKey,
    p_barber_id: selectedBarber.id
  });

  if (error) throw error;

  return (data || []).map(row => String(row.appointment_time).slice(0, 5));
}

async function renderTimes() {
  if (!selectedDate || !selectedBarber) return;

  timeGrid.innerHTML = `<div class="empty-state">Carregando horários...</div>`;

  try {
    const dateKey = toLocalDateKey(selectedDate);
    const allSlots = getSlotsForDate(selectedDate);
    const booked = await getBookedTimes(dateKey);

    if (!allSlots.length) {
      timeGrid.innerHTML = `<div class="empty-state">Não há atendimento neste dia.</div>`;
      return;
    }

    timeGrid.innerHTML = "";
    const now = new Date();

    allSlots.forEach(time => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "time-btn";
      btn.textContent = time;

      const [hour, minute] = time.split(":").map(Number);
      const slotDateTime = new Date(selectedDate);
      slotDateTime.setHours(hour, minute, 0, 0);

      const unavailable = booked.includes(time) || slotDateTime <= now;

      if (unavailable) {
        btn.disabled = true;
        btn.title = "Horário indisponível";
      } else {
        btn.addEventListener("click", () => selectTime(time, btn));
      }

      timeGrid.appendChild(btn);
    });
  } catch (error) {
    console.error(error);
    timeGrid.innerHTML = `<div class="empty-state">Erro ao consultar horários. Tente novamente.</div>`;
  }
}

function selectTime(time, button) {
  selectedTime = time;

  document.querySelectorAll(".time-btn").forEach(btn => btn.classList.remove("active"));
  button.classList.add("active");

  selectedSlotSummary.textContent =
    `${selectedBarber.display_name} • ${formatLongDate(selectedDate)} às ${selectedTime}`;

  clientStep.classList.remove("hidden");
  clientStep.scrollIntoView({ behavior: "smooth", block: "nearest" });
  prefillFromAccount();
  setTimeout(() => document.getElementById("customerName").focus(), 250);
}

customerPhone.addEventListener("input", event => {
  event.target.value = maskPhone(event.target.value);
});

async function prefillFromAccount() {
  if (!window.sb) return;

  try {
    const { data: sessionData } = await window.sb.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) return;

    const { data: profile } = await window.sb
      .from("profiles")
      .select("full_name, phone")
      .eq("id", user.id)
      .single();

    const nameInput = document.getElementById("customerName");
    const phoneInput = document.getElementById("customerPhone");

    if (nameInput && !nameInput.value) {
      nameInput.value = profile?.full_name || user.user_metadata?.full_name || "";
    }

    const storedPhone = profile?.phone || user.user_metadata?.phone || "";
    if (phoneInput && !phoneInput.value && storedPhone) {
      const national = String(storedPhone).replace(/\D/g, "").replace(/^55/, "");
      phoneInput.value = maskPhone(national);
    }
  } catch (error) {
    console.warn("Não foi possível preencher os dados da conta:", error);
  }
}


async function getCurrentBookingSession() {
  if (!window.sb) return null;

  try {
    const { data } = await window.sb.auth.getSession();
    return data.session || null;
  } catch (error) {
    console.warn("Não foi possível consultar a sessão:", error);
    return null;
  }
}

function ensureBookingSuccessDialog() {
  let backdrop = document.getElementById("accountPromptBackdrop");

  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.id = "accountPromptBackdrop";
    backdrop.className = "account-prompt-backdrop hidden";

    backdrop.innerHTML = `
      <section class="account-prompt-dialog" id="accountPromptDialog"
               role="dialog" aria-modal="true" aria-labelledby="accountPromptTitle">
        <button class="account-prompt-close" id="accountPromptClose" type="button"
                aria-label="Fechar">×</button>

        <div class="account-prompt-icon">✓</div>
        <span class="eyebrow">AGENDAMENTO CONFIRMADO</span>
        <h2 id="accountPromptTitle">Acompanhe seus agendamentos</h2>

        <p id="accountPromptText"></p>

        <div class="account-prompt-actions">
          <button class="primary-btn" id="accountPromptPrimary" type="button"></button>
          <button class="secondary-btn" id="accountPromptSecondary" type="button">
            Agora não
          </button>
        </div>
      </section>
    `;

    document.body.appendChild(backdrop);
  }

  const text = backdrop.querySelector("#accountPromptText") || backdrop.querySelector("p");
  if (text && !text.id) text.id = "accountPromptText";

  const oldPrimary = document.getElementById("accountPromptCreate");
  if (oldPrimary) oldPrimary.id = "accountPromptPrimary";

  const oldSecondary = document.getElementById("accountPromptSkip");
  if (oldSecondary) oldSecondary.id = "accountPromptSecondary";

  return backdrop;
}

function closeBookingSuccessDialog() {
  const backdrop = document.getElementById("accountPromptBackdrop");
  if (!backdrop) return;

  backdrop.classList.add("hidden");
  document.body.classList.remove("dialog-open");
}

function bindBookingSuccessDialog() {
  const backdrop = ensureBookingSuccessDialog();
  const closeButton = document.getElementById("accountPromptClose");
  const secondaryButton = document.getElementById("accountPromptSecondary");

  if (!backdrop.dataset.bound) {
    backdrop.dataset.bound = "1";

    backdrop.addEventListener("click", event => {
      if (event.target === backdrop) {
        closeBookingSuccessDialog();
      }
    });
  }

  if (closeButton && !closeButton.dataset.bound) {
    closeButton.dataset.bound = "1";
    closeButton.addEventListener("click", closeBookingSuccessDialog);
  }

  if (secondaryButton && !secondaryButton.dataset.bound) {
    secondaryButton.dataset.bound = "1";
    secondaryButton.addEventListener("click", closeBookingSuccessDialog);
  }
}

async function showBookingSuccessDialog({ name, phone }) {
  bindBookingSuccessDialog();

  const backdrop = document.getElementById("accountPromptBackdrop");
  const title = document.getElementById("accountPromptTitle");
  const text = document.getElementById("accountPromptText");
  const primary = document.getElementById("accountPromptPrimary");
  const secondary = document.getElementById("accountPromptSecondary");

  if (!backdrop || !title || !text || !primary) {
    console.error("Não foi possível montar o diálogo de confirmação.");
    return;
  }

  const session = await getCurrentBookingSession();
  const loggedIn = Boolean(session?.user);

  if (loggedIn) {
    title.textContent = "Agendamento confirmado";
    text.innerHTML = `
      Seu horário foi marcado com sucesso. Você pode acompanhar este e seus outros
      horários pela página <strong>Meus agendamentos</strong>.
    `;

    primary.textContent = "Ver meus agendamentos";
    primary.onclick = () => {
      window.location.href = "./meus-agendamentos.html";
    };

    if (secondary) secondary.textContent = "Fechar";
  } else {
    title.textContent = "Acompanhe seus agendamentos";
    text.innerHTML = `
      <strong>Para acompanhar os horários que você marcou, é necessário criar uma conta.</strong>
      É rápido: use apenas seu WhatsApp e uma senha. Depois você poderá acessar
      <strong>Meus agendamentos</strong> e consultar seus horários sempre que quiser.
    `;

    try {
      sessionStorage.setItem(
        "barbershop_signup_draft",
        JSON.stringify({ name, phone })
      );
    } catch (_) {}

    primary.textContent = "Criar conta para acompanhar";
    primary.onclick = () => {
      window.location.href = "./cadastro.html?next=meus-agendamentos";
    };

    if (secondary) secondary.textContent = "Agora não";
  }

  backdrop.classList.remove("hidden");
  document.body.classList.add("dialog-open");
}

bindBookingSuccessDialog();

bookingForm.addEventListener("submit", async event => {
  event.preventDefault();

  if (!requireSupabase()) return;

  if (!selectedBarber || !selectedDate || !selectedTime) {
    showToast("Escolha o profissional, a data e o horário.", true);
    return;
  }

  const name = document.getElementById("customerName").value.trim();
  const phone = normalizePhone(customerPhone.value);

  if (name.length < 2) {
    showToast("Informe seu nome.", true);
    return;
  }

  if (phone.length < 10 || phone.length > 11) {
    showToast("Informe um número de WhatsApp válido com DDD.", true);
    return;
  }

  confirmBookingBtn.disabled = true;
  confirmBookingBtn.textContent = "Confirmando...";

  try {
    const { data, error } = await window.sb.rpc("create_public_appointment", {
      p_barber_id: selectedBarber.id,
      p_customer_name: name,
      p_phone: `55${phone}`,
      p_date: toLocalDateKey(selectedDate),
      p_time: selectedTime,
      p_reminder_consent: true,
      p_service_id: null
    });

    if (error) {
      const rawError = `${error.message || ""} ${error.details || ""}`;

      if (rawError.includes("JA_POSSUI_AGENDAMENTO_NO_DIA")) {
        throw new Error(
          "Este WhatsApp já possui um agendamento ativo nesse dia. " +
          "Escolha outro dia ou cancele o agendamento anterior."
        );
      }

      if (rawError.includes("HORARIO_INDISPONIVEL")) {
        throw new Error("Esse horário acabou de ser reservado. Escolha outro.");
      }

      throw error;
    }

    const bookedPhone = phone;
    const bookedName = name;

    showBookingStatus(
      `<strong>Agendamento confirmado!</strong><br>
       ${escapeHtml(name)}, seu horário com ${escapeHtml(selectedBarber.display_name)}
       foi reservado para ${formatShortDate(selectedDate)} às ${selectedTime}.`
    );

    showToast("Horário agendado com sucesso.");
    bookingForm.reset();
    customerPhone.value = "";
    clientStep.classList.add("hidden");
    selectedTime = null;

    await renderTimes();
    bookingStatus.scrollIntoView({ behavior: "smooth", block: "center" });

    setTimeout(() => {
      showBookingSuccessDialog({
        name: bookedName,
        phone: bookedPhone
      });
    }, 300);
  } catch (error) {
    console.error(error);
    showBookingStatus(
      escapeHtml(error.message || "Não foi possível concluir o agendamento."),
      true
    );
    showToast(error.message || "Erro ao agendar.", true);
    await renderTimes();
  } finally {
    confirmBookingBtn.disabled = false;
    confirmBookingBtn.textContent = "Confirmar agendamento";
  }
});

loadBarbers();
