import { useState } from "react";
import { placeOrder } from "../api";

export function Checkout({ userId, cart }: { userId: number; cart: { product_id: number; qty: number }[] }) {
  const [status, setStatus] = useState<string>("");

  async function onPay() {
    try {
      const order = await placeOrder(userId, cart);
      setStatus(`Order #${order.id} ${order.status}`);
    } catch (err) {
      setStatus(String(err));
    }
  }

  return <button onClick={onPay}>Pay now</button>;
}
