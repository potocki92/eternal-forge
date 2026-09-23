/** A text field's value from submitted form data; `''` when absent or a file. */
export function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}
