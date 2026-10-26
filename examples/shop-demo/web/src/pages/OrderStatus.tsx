import { useEffect, useState } from "react";
import { getOrder } from "../api";

export function OrderStatus({ id }: { id: number }) {
  const [order, setOrder] = useState<{ status: string } | null>(null);
  useEffect(() => {
    getOrder(id).then(setOrder);
  }, [id]);
  return <p>Status: {order?.status ?? "loading"}</p>;
}
