"use client";

/* Live SHA-256 commit-id demo. Ported 1:1 from landing/script.js initHash(),
   using the shared sha256 from lib/landing. */

import { useEffect, useRef } from "react";
import { sha256, canonicalCommit } from "@/lib/landing";

export default function HashDemo() {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const canonRef = useRef<HTMLPreElement>(null);
  const outRef = useRef<HTMLParagraphElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const resetRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const input = areaRef.current;
    if (!input) return;
    const canon = canonRef.current!;
    const out = outRef.current!;
    const status = statusRef.current!;
    const resetBtn = resetRef.current!;
    const original = input.value;
    const encoder = new TextEncoder();
    const baseHash = sha256(encoder.encode(canonicalCommit(original)));

    const update = () => {
      const text = canonicalCommit(input.value);
      const hash = sha256(encoder.encode(text));
      canon.textContent = text;
      (out.querySelector(".hash-short") as HTMLElement).textContent = hash.slice(0, 7);
      (out.querySelector(".hash-rest") as HTMLElement).textContent = hash.slice(7);
      let diff = 0;
      for (let i = 0; i < 64; i += 1) if (hash[i] !== baseHash[i]) diff += 1;
      if (diff === 0) {
        status.textContent = "Same bytes, same commit id.";
        status.dataset.changed = "false";
      } else {
        status.textContent = `New commit id. ${diff} of 64 characters differ from the original.`;
        status.dataset.changed = "true";
      }
      resetBtn.disabled = diff === 0 && input.value === original;
    };

    const onReset = () => {
      input.value = original;
      update();
      input.focus();
    };
    input.addEventListener("input", update);
    resetBtn.addEventListener("click", onReset);
    update();

    return () => {
      input.removeEventListener("input", update);
      resetBtn.removeEventListener("click", onReset);
    };
  }, []);

  return (
    <>
      <label htmlFor="hash-msg" className="hash-label">
        Commit message
      </label>
      <textarea
        ref={areaRef}
        id="hash-msg"
        rows={2}
        spellCheck={false}
        defaultValue="Spec the limit: 100 requests per minute per API key."
      />
      <p className="hash-label">Bytes hashed (sorted keys, UTF-8, no whitespace)</p>
      <pre className="canon" id="hash-canon" ref={canonRef} tabIndex={0} />
      <p className="hash-label">SHA-256, the commit id</p>
      <p className="hash-out mono" id="hash-out" ref={outRef}>
        <span className="hash-short" />
        <span className="hash-rest" />
      </p>
      <div className="hash-foot">
        <p className="hash-status" id="hash-status" ref={statusRef} />
        <button type="button" className="btn btn-ghost btn-sm" id="hash-reset" ref={resetRef}>
          Reset message
        </button>
        {/* status text and data-changed are filled in by the effect after mount */}
      </div>
      <p className="fineprint">Computed live in your browser with the same rules as the data model. Parent ids are shortened here.</p>
    </>
  );
}
