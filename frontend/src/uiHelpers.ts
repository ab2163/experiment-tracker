// Spread onto <input>/<textarea> to disable browser autocomplete, autocorrect,
// autocapitalize, and the red spellcheck underline across every entry field.
export const noAssist = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
} as const;
