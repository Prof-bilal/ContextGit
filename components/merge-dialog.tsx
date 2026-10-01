"use client";

/* Merge preview dialog. Ported 1:1 from landing/script.js initMerge(): the
   conflict radios, summary edit field, fake apply with loading state, done
   panel and reset buttons. */

import { useEffect } from "react";

export default function MergeDialog() {
  useEffect(() => {
    const form = document.getElementById("merge-dialog") as HTMLFormElement | null;
    if (!form) return;
    const error = document.getElementById("merge-error")!;
    const apply = document.getElementById("merge-apply") as HTMLButtonElement;
    const reset = document.getElementById("merge-reset") as HTMLButtonElement;
    const done = document.getElementById("merge-done")!;
    const editField = document.getElementById("edit-field")!;
    const editArea = document.getElementById("edit-summary") as HTMLTextAreaElement;
    const step = document.getElementById("step-apply")!;
    const radios = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="resolution"]'));
    const html = (tag: string, props: Record<string, string> = {}, children: Element[] = []) => {
      const node = document.createElement(tag);
      Object.entries(props).forEach(([k, v]) => {
        if (k === "text") node.textContent = v;
        else if (k === "class") node.className = v;
        else node.setAttribute(k, v);
      });
      children.forEach((c) => node.appendChild(c));
      return node;
    };
    let resolutionNote: HTMLElement | null = null;
    let timer: number | undefined;

    const showError = (msg: string, focusTarget?: HTMLElement) => {
      error.textContent = msg;
      error.hidden = false;
      focusTarget?.focus();
    };
    const clearError = () => {
      error.hidden = true;
      error.textContent = "";
    };
    const choice = () => radios.find((r) => r.checked)?.value;

    const onRadioChange = () => {
      clearError();
      editField.hidden = choice() !== "edit";
      if (choice() === "edit") editArea.focus();
    };
    radios.forEach((r) => {
      r.addEventListener("change", onRadioChange);
    });
    const onEditInput = () => clearError();
    editArea.addEventListener("input", onEditInput);

    const onSubmit = (e: Event) => {
      e.preventDefault();
      const picked = choice();
      if (!picked) {
        showError(
          "Choose how to resolve the logging conflict before applying. A merge never resolves a conflict for you.",
          radios[0]
        );
        return;
      }
      if (picked === "edit" && !editArea.value.trim()) {
        showError("The summary line is empty. Write the line to store in the merge commit, or pick a side.", editArea);
        return;
      }
      clearError();
      apply.disabled = true;
      reset.disabled = true;
      apply.textContent = "Writing merge commit";

      timer = window.setTimeout(
        () => {
          const text =
            picked === "target"
              ? "Conflict resolved: kept the target. Every allow and deny decision is logged."
              : picked === "source"
                ? "Conflict resolved: kept the source. Counters only, no per-request logging."
                : `Conflict resolved by edit: ${editArea.value.trim()}`;
          if (resolutionNote) resolutionNote.remove();
          resolutionNote = html("p", { class: "done-note", text });
          done.insertBefore(resolutionNote, done.querySelector(".done-grid"));
          form.dataset.state = "done";
          done.hidden = false;
          step.dataset.done = "true";
          apply.disabled = false;
          reset.disabled = false;
          apply.textContent = "Apply merge";
          done.focus();
        },
        window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 650
      );
    };
    form.addEventListener("submit", onSubmit);

    const clearForm = () => {
      radios.forEach((r) => {
        r.checked = false;
      });
      editField.hidden = true;
      clearError();
    };
    const onReset = () => clearForm();
    reset.addEventListener("click", onReset);

    const doneReset = html("button", { type: "button", class: "btn btn-ghost-night", text: "Reset preview" });
    done.appendChild(doneReset);
    const onDoneReset = () => {
      radios.forEach((r) => {
        r.checked = false;
      });
      editField.hidden = true;
      form.dataset.state = "idle";
      done.hidden = true;
      step.dataset.done = "false";
      if (resolutionNote) {
        resolutionNote.remove();
        resolutionNote = null;
      }
      radios[0].focus();
    };
    doneReset.addEventListener("click", onDoneReset);

    return () => {
      if (timer !== undefined) clearTimeout(timer);
      form.removeEventListener("submit", onSubmit);
      reset.removeEventListener("click", onReset);
      doneReset.removeEventListener("click", onDoneReset);
      radios.forEach((r) => r.removeEventListener("change", onRadioChange));
      editArea.removeEventListener("input", onEditInput);
      doneReset.remove();
    };
  }, []);

  return null;
}
