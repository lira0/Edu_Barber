document.addEventListener("DOMContentLoaded", initUserMenu);

async function initUserMenu() {
  if (!window.sb) return;

  const { data: sessionData } = await window.sb.auth.getSession();
  const user = sessionData.session?.user;
  if (!user) return;

  let profile = null;

  try {
    const { data, error } = await window.sb
      .from("profiles")
      .select("full_name, role")
      .eq("id", user.id)
      .single();

    if (!error) profile = data;
  } catch (error) {
    console.warn("Não foi possível carregar o perfil do menu:", error);
  }

  const canAdmin = ["barber", "admin"].includes(profile?.role);
  const name =
    profile?.full_name ||
    user.user_metadata?.full_name ||
    user.email ||
    "Cliente";

  const trigger = document.getElementById("userMenuTrigger");
  const backdrop = document.getElementById("userDrawerBackdrop");
  const drawer = document.getElementById("userDrawer");
  const closeButton = document.getElementById("userDrawerClose");
  const logoutButton = document.getElementById("drawerLogout");
  const adminLink = document.getElementById("userDrawerAdmin");
  const drawerName = document.getElementById("userDrawerName");
  const drawerEmail = document.getElementById("userDrawerEmail");

  if (!trigger || !drawer || !backdrop) {
    console.error("Estrutura do menu lateral não encontrada no HTML.");
    return;
  }

  trigger.classList.remove("hidden");

  if (drawerName) drawerName.textContent = name;
  if (drawerEmail) drawerEmail.textContent = user.email || "";

  if (adminLink) {
    adminLink.classList.toggle("hidden", !canAdmin);
  }

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

  logoutButton?.addEventListener("click", async () => {
    logoutButton.disabled = true;
    await window.sb.auth.signOut();
    window.location.href = "./index.html";
  });
}
