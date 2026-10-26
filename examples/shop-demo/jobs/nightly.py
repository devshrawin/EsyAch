"""Nightly ETL: aggregate yesterday's orders into a CSV sales report."""
import csv
import datetime
import os

from sqlalchemy import text

from api.db import engine

REPORT_DIR = os.getenv("REPORT_DIR", "/var/reports")


def extract(day):
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT status, COUNT(*), SUM(total) FROM orders WHERE created_at::date = :day GROUP BY status"),
            {"day": day},
        ).fetchall()


def load(day, rows):
    path = os.path.join(REPORT_DIR, f"sales-{day}.csv")
    with open(path, "w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["status", "orders", "revenue"])
        writer.writerows(rows)
    return path


def main():
    day = datetime.date.today() - datetime.timedelta(days=1)
    load(day, extract(day))


if __name__ == "__main__":
    main()
