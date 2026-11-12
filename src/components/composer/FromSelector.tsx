import type { SendAsAlias } from "@/services/db/sendAsAliases";
import { Select } from "@/components/ui/Select";

interface FromSelectorProps {
  aliases: SendAsAlias[];
  selectedEmail: string;
  onChange: (alias: SendAsAlias) => void;
}

/**
 * Dropdown for selecting a send-as alias in the composer.
 * Only visible when more than one alias is available.
 */
export function FromSelector({ aliases, selectedEmail, onChange }: FromSelectorProps) {
  if (aliases.length <= 1) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-text-tertiary w-8 shrink-0">
        From
      </span>
      <Select
        value={selectedEmail}
        onChange={(val) => {
          const alias = aliases.find((a) => a.email === val);
          if (alias) onChange(alias);
        }}
        options={aliases.map((alias) => ({
          value: alias.email,
          label: alias.displayName
            ? `${alias.displayName} <${alias.email}>`
            : alias.email,
        }))}
        className="flex-1"
      />
    </div>
  );
}
