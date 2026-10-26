import { useEffect, useState } from "react";
import { listProducts } from "../api";

export function Products() {
  const [items, setItems] = useState<{ id: number; name: string; price: number }[]>([]);
  useEffect(() => {
    listProducts().then(setItems);
  }, []);
  return <ul>{items.map((p) => <li key={p.id}>{p.name} — ${p.price}</li>)}</ul>;
}
