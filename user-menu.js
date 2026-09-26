document.addEventListener("DOMContentLoaded", async () => {
  if (!window.sb) return;

  const { data: sessionData } = await window.sb.auth.getSession();
  const user = sessionData.session?.user;
  if (!user) return;

  let profile = null;
  try {
    const { data } = await window.sb
      .from("profiles")
      .select("full_name, role")
      .eq("id", user.id)
      .single();
    profile = data;
  } catch (_) {}

  const canAdmin = ["barber", "admin"].includes(profile?.role);
  const name = profile?.full_name || user.user_metadata?.full_name || user.email || "Cliente";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "user-menu-trigger";
  trigger.setAttribute("aria-label", "Abrir menu do usuário");
  trigger.textContent = "☰";

  const backdrop = document.createElement("div");
  backdrop.className = "user-drawer-backdrop";

  const drawer = document.createElement("aside");
  drawer.className = "user-drawer";
  drawer.setAttribute("aria-hidden", "true");
  drawer.innerHTML = `
    <div class="user-drawer-header">
      <div class="user-drawer-person">
        <strong>${escapeMenuHtml(name)}</strong>
        <span>${escapeMenuHtml(user.email || "")}</span>
      </div>
      <button class="user-drawer-close" type="button" aria-label="Fechar menu">×</button>
    </div>

    <nav class="user-drawer-nav">
      <a href="./index.html">⌂ Início</a>
      <a href="./index.html#agendamento">✂ Agendar horário</a>
      <a href="./meus-agendamentos.html">📅 Meus agendamentos</a>
      <a href="./conta.html">👤 Minha conta</a>
      ${canAdmin ? '<a class="admin-only" href="./admin.html">💈 Painel administrativo</a>' : ''}
    </nav>

    <div class="user-drawer-footer user-drawer-nav">
      <button id="drawerLogout" type="button">↪ Sair</button>
    </div>
  `;

  document.body.appendChild(trigger);
  document.body.appendChild(backdrop);
  document.body.appendChild(drawer);

  const open = () => {
    backdrop.classList.add("open");
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
  };
  const close = () => {
    backdrop.classList.remove("open");
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
  };

  trigger.addEventListener("click", open);
  backdrop.addEventListener("click", close);
  drawer.querySelector(".user-drawer-close")?.addEventListener("click", close);
  drawer.querySelector("#drawerLogout")?.addEventListener("click", async () => {
    await window.sb.auth.signOut();
    window.location.href = "./index.html";
  });
});

function escapeMenuHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}
