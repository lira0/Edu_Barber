const authStatus = document.getElementById("authStatus");

// Clientes não precisam fornecer e-mail.
// O site converte o WhatsApp em um e-mail técnico interno apenas para o Supabase Auth.
// Esse endereço nunca é mostrado ao cliente e não recebe mensagens.
const CUSTOMER_AUTH_DOMAIN = "barbearia.invalid";

function setAuthStatus(message, type = "info") {
  if (!authStatus) return;
  authStatus.textContent = message;
  authStatus.className = `auth-status ${type}`;
}

function ensureSupabase() {
  if (window.sb) return true;

  setAuthStatus(
    "Supabase ainda não foi configurado. Preencha a URL e a Publishable Key em config.js.",
    "error"
  );
  return false;
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeNationalPhone(value) {
  let d = digits(value);

  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    d = d.slice(2);
  }

  if (d.length !== 10 && d.length !== 11) return null;
  return d;
}

function toDatabasePhone(value) {
  const national = normalizeNationalPhone(value);
  return national ? `55${national}` : null;
}

function customerTechnicalEmail(value) {
  const dbPhone = toDatabasePhone(value);
  if (!dbPhone) return null;

  return `cliente.${dbPhone}@${CUSTOMER_AUTH_DOMAIN}`;
}

function isTechnicalCustomerEmail(email) {
  return String(email || "")
    .toLowerCase()
    .endsWith(`@${CUSTOMER_AUTH_DOMAIN}`);
}

function formatPhone(value) {
  const d = normalizeNationalPhone(value) || digits(value).slice(-11);

  if (!d) return "";
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0,2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
}

document.querySelectorAll("[data-phone-mask]").forEach(input => {
  input.addEventListener("input", event => {
    event.target.value = formatPhone(event.target.value);
  });
});

async function claimGuestAppointments() {
  if (!window.sb) return;

  try {
    const { error } = await window.sb.rpc("claim_my_guest_appointments");

    if (error) {
      console.warn("Não foi possível vincular agendamentos antigos:", error);
    }
  } catch (error) {
    console.warn("Falha ao vincular agendamentos antigos:", error);
  }
}

function readSignupDraft() {
  try {
    return JSON.parse(sessionStorage.getItem("barbershop_signup_draft") || "null");
  } catch {
    return null;
  }
}

function clearSignupDraft() {
  try {
    sessionStorage.removeItem("barbershop_signup_draft");
  } catch (_) {}
}

const registerForm = document.getElementById("registerForm");

if (registerForm) {
  const draft = readSignupDraft();

  if (draft) {
    const nameInput = document.getElementById("registerName");
    const phoneInput = document.getElementById("registerPhone");

    if (nameInput && draft.name) nameInput.value = draft.name;
    if (phoneInput && draft.phone) phoneInput.value = formatPhone(draft.phone);
  }
}

registerForm?.addEventListener("submit", async event => {
  event.preventDefault();

  if (!ensureSupabase()) return;

  const button = registerForm.querySelector('button[type="submit"]');

  const fullName = document.getElementById("registerName").value.trim();
  const phoneInput = document.getElementById("registerPhone").value;
  const dbPhone = toDatabasePhone(phoneInput);
  const technicalEmail = customerTechnicalEmail(phoneInput);
  const password = document.getElementById("registerPassword").value;
  const confirmPassword = document.getElementById("registerConfirmPassword").value;

  if (fullName.length < 2) {
    return setAuthStatus("Informe seu nome.", "error");
  }

  if (!dbPhone || !technicalEmail) {
    return setAuthStatus("Informe um WhatsApp válido com DDD.", "error");
  }

  if (password.length < 6) {
    return setAuthStatus("A senha precisa ter pelo menos 6 caracteres.", "error");
  }

  if (password !== confirmPassword) {
    return setAuthStatus("As senhas não coincidem.", "error");
  }

  button.disabled = true;
  button.textContent = "Criando conta...";
  setAuthStatus("Criando sua conta...", "info");

  const { data, error } = await window.sb.auth.signUp({
    email: technicalEmail,
    password,
    options: {
      data: {
        full_name: fullName,
        phone: dbPhone,
        customer_account: true
      }
    }
  });

  if (error) {
    button.disabled = false;
    button.textContent = "Criar minha conta";

    const raw = String(error.message || "");

    if (raw.toLowerCase().includes("already registered")) {
      return setAuthStatus(
        "Já existe uma conta usando esse WhatsApp. Use a tela de login.",
        "error"
      );
    }

    return setAuthStatus(
      raw || "Não foi possível criar a conta.",
      "error"
    );
  }

  if (!data.session) {
    button.disabled = false;
    button.textContent = "Criar minha conta";

    return setAuthStatus(
      "O Supabase está exigindo confirmação de e-mail. " +
      "Desative Confirm email em Authentication → Providers → Email.",
      "error"
    );
  }

  await claimGuestAppointments();
  clearSignupDraft();

  setAuthStatus(
    "Conta criada com sucesso. Você já está conectado.",
    "success"
  );

  const params = new URLSearchParams(window.location.search);
  const next = params.get("next");

  setTimeout(() => {
    window.location.href =
      next === "meus-agendamentos"
        ? "./meus-agendamentos.html"
        : "./conta.html";
  }, 550);
});

const loginForm = document.getElementById("loginForm");

async function getLoginProfileRole() {
  if (!window.sb) return null;

  const {
    data: { user }
  } = await window.sb.auth.getUser();

  if (!user) return null;

  const { data, error } = await window.sb
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Não foi possível consultar a função da conta:", error);
    return null;
  }

  return data?.role || null;
}

loginForm?.addEventListener("submit", async event => {
  event.preventDefault();

  if (!ensureSupabase()) return;

  if (!window.BarberAuth?.signInWithIdentity) {
    return setAuthStatus(
      "O módulo de login não foi carregado. Atualize a página e tente novamente.",
      "error"
    );
  }

  const button = loginForm.querySelector('button[type="submit"]');
  const identity = document.getElementById("loginIdentity").value.trim();
  const password = document.getElementById("loginPassword").value;

  if (!identity) {
    return setAuthStatus("Informe seu telefone ou e-mail.", "error");
  }

  if (!password) {
    return setAuthStatus("Informe sua senha.", "error");
  }

  button.disabled = true;
  button.textContent = "Entrando...";
  setAuthStatus("Validando acesso...", "info");

  const { error } = await window.BarberAuth.signInWithIdentity(
    identity,
    password
  );

  if (error) {
    console.error("Falha no login:", error);

    button.disabled = false;
    button.textContent = "Entrar";

    if (String(error.message || "") === "INVALID_PHONE") {
      return setAuthStatus(
        "Informe um telefone válido com DDD.",
        "error"
      );
    }

    return setAuthStatus(
      "Telefone/e-mail ou senha inválidos.",
      "error"
    );
  }

  const role = await getLoginProfileRole();

  if (!role) {
    await window.sb.auth.signOut();

    button.disabled = false;
    button.textContent = "Entrar";

    return setAuthStatus(
      "Não foi possível identificar o tipo da conta.",
      "error"
    );
  }

  /* A conta do S5 é interna e não deve entrar no site. */
  if (role === "device") {
    await window.sb.auth.signOut();

    button.disabled = false;
    button.textContent = "Entrar";

    return setAuthStatus(
      "Esta conta é exclusiva do dispositivo de lembretes.",
      "error"
    );
  }

  /*
    Somente clientes devem reivindicar agendamentos feitos
    anteriormente como visitante.
  */
  if (role === "customer") {
    await claimGuestAppointments();
  }

  button.disabled = false;
  button.textContent = "Entrar";
  setAuthStatus("Login realizado com sucesso.", "success");

  setTimeout(() => {
    if (role === "barber" || role === "admin") {
      window.location.href = "./admin.html";
      return;
    }

    window.location.href = "./meus-agendamentos.html";
  }, 450);
});

async function initAccountPage() {
  const accountPage = document.getElementById("accountPage");
  if (!accountPage) return;

  if (!ensureSupabase()) return;

  const { data: sessionData } = await window.sb.auth.getSession();
  const user = sessionData.session?.user;

  if (!user) {
    window.location.replace("./login.html");
    return;
  }

  const { data: profile, error } = await window.sb
    .from("profiles")
    .select("full_name, phone, role, created_at")
    .eq("id", user.id)
    .single();

  const accountEmail = document.getElementById("accountEmail");
  const accountName = document.getElementById("accountName");
  const accountPhone = document.getElementById("accountPhone");

  if (accountEmail) {
    const realEmail =
      user.email && !isTechnicalCustomerEmail(user.email)
        ? user.email
        : "Não informado";

    accountEmail.textContent = realEmail;
  }

  if (accountName) {
    accountName.textContent =
      profile?.full_name ||
      user.user_metadata?.full_name ||
      "—";
  }

  if (accountPhone) {
    const storedPhone =
      profile?.phone ||
      user.user_metadata?.phone ||
      "";

    accountPhone.textContent =
      storedPhone
        ? formatPhone(String(storedPhone).replace(/^55/, ""))
        : "—";
  }

  if (error) {
    setAuthStatus(
      "Conta autenticada, mas não foi possível carregar o perfil.",
      "error"
    );
  }

  document.getElementById("accountLogout")?.addEventListener("click", async () => {
    await window.sb.auth.signOut();
    window.location.href = "./index.html";
  });
}

initAccountPage();
