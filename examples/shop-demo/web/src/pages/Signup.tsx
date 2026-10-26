import { signup } from "../api";

export function Signup() {
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await signup(String(form.get("email")), String(form.get("password")));
  }
  return (
    <form onSubmit={onSubmit}>
      <input name="email" type="email" />
      <input name="password" type="password" />
      <button type="submit">Create account</button>
    </form>
  );
}
