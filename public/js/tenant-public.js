(() => {
  const menuBtn = document.getElementById("tenantMenuBtn");
  const mobileNav = document.getElementById("tenantMobileNav");
  const closeMenu = () => {
    mobileNav?.classList.remove("open");
    menuBtn?.setAttribute("aria-expanded", "false");
    const icon = menuBtn?.querySelector("i");
    if (icon) icon.className = "fa-solid fa-bars";
  };
  menuBtn?.addEventListener("click", () => {
    const opening = !mobileNav?.classList.contains("open");
    mobileNav?.classList.toggle("open", opening);
    menuBtn.setAttribute("aria-expanded", opening ? "true" : "false");
    const icon = menuBtn.querySelector("i");
    if (icon) icon.className = opening ? "fa-solid fa-xmark" : "fa-solid fa-bars";
  });
  mobileNav?.querySelectorAll("a").forEach((a) => a.addEventListener("click", closeMenu));
  window.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu(); });

  const modal = document.getElementById("announcementModal");
  if (modal) {
    const title = modal.querySelector("[data-modal-title]");
    const date = modal.querySelector("[data-modal-date]");
    const body = modal.querySelector("[data-modal-body]");
    const close = () => { modal.hidden = true; document.body.classList.remove("modal-open"); };
    document.querySelectorAll("[data-announcement-open]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.getAttribute("data-announcement-open");
        const source = document.getElementById(`announcementSource-${id}`);
        if (!source) return;
        if (title) title.textContent = source.querySelector("[data-source-title]")?.textContent?.trim() || "Announcement";
        if (date) date.textContent = source.querySelector("[data-source-date]")?.textContent?.trim() || "";
        if (body) body.textContent = source.querySelector("[data-source-body]")?.textContent?.trim() || "";
        modal.hidden = false;
        document.body.classList.add("modal-open");
        modal.querySelector("[data-announcement-close]")?.focus();
      });
    });
    modal.querySelectorAll("[data-announcement-close]").forEach((node) => node.addEventListener("click", close));
    window.addEventListener("keydown", (event) => { if (event.key === "Escape" && !modal.hidden) close(); });
  }
})();
