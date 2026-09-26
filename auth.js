const authStatus = document.getElementById("authStatus");

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

function formatPhone(value) {
  const d = digits(value).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0,2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
}

document.querySelectorAll("[data-phone-mask]").forEach(input => {
  input.addEventListener("input", e => {
    e.target.value = formatPhone(e.target.value);
  });
});

const registerForm = document.getElementById("registerForm");
registerForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!ensureSupabase()) return;

  const button = registerForm.querySelector('button[type="submit"]');
  const fullName = document.getElementById("registerName").value.trim();
  const phoneRaw = digits(document.getElementById("registerPhone").value);
  const email = document.getElementById("registerEmail").value.trim().toLowerCase();
  const password = document.getElementById("registerPassword").value;
  const confirmPassword = document.getElementById("registerConfirmPassword").value;

  if (fullName.length < 2) return setAuthStatus("Informe seu nome.", "error");
  if (phoneRaw.length < 10 || phoneRaw.length > 11) return setAuthStatus("Informe um telefone válido com DDD.", "error");
  if (!email.includes("@")) return setAuthStatus("Informe um e-mail válido.", "error");
  if (password.length < 6) return setAuthStatus("A senha precisa ter pelo menos 6 caracteres.", "error");
  if (password !== confirmPassword) return setAuthStatus("As senhas não coincidem.", "error");

  button.disabled = true;
  button.textContent = "Criando conta...";
  setAuthStatus("Criando sua conta...", "info");

  const redirectTo = new URL("./login.html?confirmed=1", window.location.href).href;

  const { data, error } = await window.sb.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: redirectTo,
      data: {
        full_name: fullName,
        phone: `55${phoneRaw}`
      }
    }
  });

  button.disabled = false;
  button.textContent = "Criar minha conta";

  if (error) {
    return setAuthStatus(error.message || "Não foi possível criar a conta.", "error");
  }

  if (data.session) {
    setAuthStatus("Conta criada. Entrando...", "success");
    setTimeout(() => window.location.href = "./conta.html", 700);
  } else {
    setAuthStatus(
      "Conta criada! Confira seu e-mail para confirmar o cadastro e depois faça login.",
      "success"
    );
    registerForm.reset();
  }
});

const loginForm = document.getElementById("loginForm");
loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!ensureSupabase()) return;

  const button = loginForm.querySelector('button[type="submit"]');
  const email = document.getElementById("loginEmail").value.trim().toLowerCase();
  const password = document.getElementById("loginPassword").value;

  button.disabled = true;
  button.textContent = "Entrando...";
  setAuthStatus("Validando acesso...", "info");

  const { error } = await window.sb.auth.signInWithPassword({ email, password });

  button.disabled = false;
  button.textContent = "Entrar";

  if (error) {
    return setAuthStatus("E-mail ou senha inválidos, ou conta ainda não confirmada.", "error");
  }

  setAuthStatus("Login realizado com sucesso.", "success");
  setTimeout(() => {
    window.location.href = "./index.html#agendamento";
  }, 500);
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
    .select("full_name, phone, created_at")
    .eq("id", user.id)
    .single();

  document.getElementById("accountEmail").textContent = user.email || "—";
  document.getElementById("accountName").textContent =
    profile?.full_name || user.user_metadata?.full_name || "—";
  document.getElementById("accountPhone").textContent =
    profile?.phone || user.user_metadata?.phone || "—";

  if (error) {
    setAuthStatus("Conta autenticada, mas não foi possível carregar o perfil.", "error");
  }

  document.getElementById("accountLogout")?.addEventListener("click", async () => {
    await window.sb.auth.signOut();
    window.location.href = "./index.html";
  });
}

initAccountPage();

const params = new URLSearchParams(window.location.search);
if (params.get("confirmed") === "1" && authStatus) {
  setAuthStatus("E-mail confirmado. Agora você já pode entrar.", "success");
}
