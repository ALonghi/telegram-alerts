/** End interactive security input with EOF, not a shell exit command. */
export function keychainInput(args: string[]): string {
  if (!args.length || args.some((arg) => !/^[A-Za-z0-9_.:-]+$/.test(arg))) {
    throw new Error("Invalid Keychain command argument.");
  }
  return `${args.join(" ")}\n`;
}
