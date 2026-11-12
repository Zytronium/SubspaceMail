import { useState, useEffect } from "react";
import { useComposerStore } from "@/stores/composerStore";
import { useAccountStore } from "@/stores/accountStore";
import {
  getSignaturesForAccount,
  type DbSignature,
} from "@/services/db/signatures";
import { Select } from "@/components/ui/Select";

export function SignatureSelector() {
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const isOpen = useComposerStore((s) => s.isOpen);
  const signatureId = useComposerStore((s) => s.signatureId);
  const setSignatureHtml = useComposerStore((s) => s.setSignatureHtml);
  const setSignatureId = useComposerStore((s) => s.setSignatureId);
  const [signatures, setSignatures] = useState<DbSignature[]>([]);

  useEffect(() => {
    if (!isOpen || !activeAccountId) return;
    let cancelled = false;
    getSignaturesForAccount(activeAccountId).then((sigs) => {
      if (!cancelled) setSignatures(sigs);
    });
    return () => { cancelled = true; };
  }, [isOpen, activeAccountId]);

  if (signatures.length === 0) return null;

  const handleChange = (id: string) => {
    if (id === "") {
      setSignatureId(null);
      setSignatureHtml("");
      return;
    }
    const sig = signatures.find((s) => s.id === id);
    if (sig) {
      setSignatureId(sig.id);
      setSignatureHtml(sig.body_html);
    }
  };

  return (
    <Select
      value={signatureId ?? ""}
      onChange={handleChange}
      options={[
        { value: "", label: "No signature" },
        ...signatures.map((sig) => ({ value: sig.id, label: sig.name })),
      ]}
      className="text-[0.625rem]"
    />
  );
}
