const BASE = import.meta.env.VITE_API_URL ?? "/api";

export async function signup(email: string, password: string) {
  const res = await fetch(`${BASE}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`signup failed: ${res.status}`);
  return res.json();
}

export async function listProducts() {
  const res = await fetch(`${BASE}/products`);
  return res.json();
}

export async function placeOrder(userId: number, items: { product_id: number; qty: number }[]) {
  const res = await fetch(`${BASE}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, items }),
  });
  if (res.status === 402) throw new Error("payment declined");
  return res.json();
}

export async function getOrder(id: number) {
  const res = await fetch(`${BASE}/orders/${id}`);
  return res.json();
}
