document.documentElement.classList.add("js");
try {
  const theme = localStorage.getItem("contextgit-theme");
  const dark = theme === "dark" || (!theme && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
} catch {
  // Storage can be disabled; the CSS default remains usable.
}
