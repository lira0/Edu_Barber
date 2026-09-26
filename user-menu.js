document.addEventListener("DOMContentLoaded", initUserMenu);

async function initUserMenu() {
  const trigger = document.getElementById("userMenuTrigger");
  const backdrop = document.getElementById("userDrawerBackdrop");
  const drawer = document.getElementById("userDrawer");
  const closeButton = document.getElementById("userDrawerClose");

  if (!trigger || !drawer || !backdrop) {
    console.error("Estrutura do menu lateral não encontrada no HTML.");
    return;
  }

  // O menu existe para todos, inclusive visitantes.
  trigger.classList.remove("hidden");

  const openMenu = () => {
    backdrop.classList.add("open");
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("drawer-open");
  };

  const closeMenu = () => {
    backdrop.classList.remove("open");
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("drawer-open");
  };

  trigger.addEventListener("click", openMenu);
  backdrop.addEventListener("click", closeMenu);
  closeButton?.addEventListener("click", closeMenu);

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeMenu();
  });

  // Estado padrão: visitante.
  renderGuestMenu();

  // Se o Supabase não estiver disponível, o menu público continua funcionando.
  if (!window.sb) return;

  try {
    const { data: sessionData } = await window.sb.auth.getSession();
    const user = sessionData.session?.user;

    if (!user) {
      renderGuestMenu();
      return;
    }

    let profile = null;

    const { data, error } = await window.sb
      .from("profiles")
      .select("full_name, role")
      .eq("id", user.id)
      .single();

    if (!error) profile = data;

    renderAuthenticatedMenu(user, profile);

    // Mantém o menu sincronizado caso login/logout aconteça sem recarregar.
    window.sb.auth.onAuthStateChange(async (_event, session) => {
      if (!session?.user) {
        renderGuestMenu();
        return;
      }

      let nextProfile = null;

      try {
        const { data } = await window.sb
          .from("profiles")
          .select("full_name, role")
          .eq("id", session.user.id)
          .single();

        nextProfile = data;
      } catch (_) {}

      renderAuthenticatedMenu(session.user, nextProfile);
    });
  } catch (error) {
    console.warn("Não foi possível consultar a sessão do Supabase:", error);
    renderGuestMenu();
  }
}

function renderGuestMenu() {
  const name = document.getElementById("userDrawerName");
  const email = document.getElementById("userDrawerEmail");
  const admin = document.getElementById("userDrawerAdmin");

  if (name) name.textContent = "Visitante";
  if (email) email.textContent = "Entre para acompanhar seus horários";

  document.querySelectorAll(".drawer-auth-only").forEach(el => {
    el.classList.add("hidden");
  });

  document.querySelectorAll(".drawer-guest-only").forEach(el => {
    el.classList.remove("hidden");
  });

  admin?.classList.add("hidden");
}

function renderAuthenticatedMenu(user, profile) {
  const name = document.getElementById("userDrawerName");
  const email = document.getElementById("userDrawerEmail");
  const admin = document.getElementById("userDrawerAdmin");
  const logout = document.getElementById("drawerLogout");

  const displayName =
    profile?.full_name ||
    user.user_metadata?.full_name ||
    user.email ||
    "Cliente";

  if (name) name.textContent = displayName;
  if (email) email.textContent = user.email || "";

  document.querySelectorAll(".drawer-auth-only").forEach(el => {
    el.classList.remove("hidden");
  });

  document.querySelectorAll(".drawer-guest-only").forEach(el => {
    el.classList.add("hidden");
  });

  const canAdmin = ["barber", "admin"].includes(profile?.role);
  admin?.classList.toggle("hidden", !canAdmin);

  if (logout && !logout.dataset.bound) {
    logout.dataset.bound = "1";

    logout.addEventListener("click", async () => {
      if (!window.sb) return;

      logout.disabled = true;

      try {
        await window.sb.auth.signOut();
        window.location.href = "./index.html";
      } finally {
        logout.disabled = false;
      }
    });
  }
}
