document.addEventListener("DOMContentLoaded", async () => {
  const loginLink = document.getElementById("navLogin");
  const registerLink = document.getElementById("navRegister");
  const accountLink = document.getElementById("navAccount");
  const logoutBtn = document.getElementById("navLogout");

  if (!window.sb) return;

  const render = (session) => {
    const logged = Boolean(session?.user);
    loginLink?.classList.toggle("hidden", logged);
    registerLink?.classList.toggle("hidden", logged);
    accountLink?.classList.toggle("hidden", !logged);
    logoutBtn?.classList.toggle("hidden", !logged);
  };

  const { data } = await window.sb.auth.getSession();
  render(data.session);

  window.sb.auth.onAuthStateChange((_event, session) => render(session));

  logoutBtn?.addEventListener("click", async () => {
    await window.sb.auth.signOut();
    window.location.href = "./index.html";
  });
});
