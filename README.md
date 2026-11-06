# family-finance-bot
import os
import asyncio
import sqlite3
import calendar
from datetime import datetime, date, timedelta
from zoneinfo import ZoneInfo

from aiogram import Bot, Dispatcher
from aiogram.filters import Command
from aiogram.types import Message

TOKEN = os.getenv("BOT_TOKEN")
if not TOKEN:
    raise RuntimeError("Не задан BOT_TOKEN")

bot = Bot(token=TOKEN)
dp = Dispatcher()
DB = "family.db"
TZ = ZoneInfo("Europe/Moscow")


def init_db():
    with sqlite3.connect(DB) as con:
        con.execute("""
            CREATE TABLE IF NOT EXISTS bills (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT,
                amount REAL,
                day INTEGER,
                responsible TEXT,
                chat_id INTEGER,
                paid_month TEXT DEFAULT ''
            )
        """)
        con.execute("""
            CREATE TABLE IF NOT EXISTS notices (
                bill_id INTEGER,
                notice_date TEXT,
                kind TEXT,
                UNIQUE(bill_id, notice_date, kind)
            )
        """)


def month_key():
    return datetime.now(TZ).strftime("%Y-%m")


@dp.message(Command("start"))
async def start(message: Message):
    await message.answer(
        "Привет! Я семейный помощник по платежам 💰\n\n"
        "Добавить: /add Интернет | 900 | 15 | Папа\n"
        "Список: /list\n"
        "Оплатить: /paid 1\n"
        "Отчёт: /report\n"
        "Помощь: /help"
    )


@dp.message(Command("help"))
async def help_cmd(message: Message):
    await start(message)


@dp.message(Command("add"))
async def add_bill(message: Message):
    try:
        data = message.text.split(" ", 1)[1]
        title, amount, day, responsible = [x.strip() for x in data.split("|")]
        amount = float(amount.replace(",", "."))
        day = int(day)
        if amount <= 0 or not 1 <= day <= 31:
            raise ValueError()
        with sqlite3.connect(DB) as con:
            cur = con.execute(
                "INSERT INTO bills(title, amount, day, responsible, chat_id) "
                "VALUES (?, ?, ?, ?, ?)",
                (title, amount, day, responsible, message.chat.id)
            )
            bill_id = cur.lastrowid
        await message.answer(
            f"✅ Добавлен платёж №{bill_id}: {title}, {amount:.2f} ₽, "
            f"число {day}, ответственный: {responsible}"
        )
    except Exception:
        await message.answer(
            "Формат неверный.\nПример:\n/add Интернет | 900 | 15 | Папа"
        )


@dp.message(Command("list"))
async def list_bills(message: Message):
    with sqlite3.connect(DB) as con:
        rows = con.execute(
            "SELECT id, title, amount, day, responsible, paid_month "
            "FROM bills WHERE chat_id=? ORDER BY day",
            (message.chat.id,)
        ).fetchall()

    if not rows:
        await message.answer("Платежей пока нет. Добавь первый через /add")
        return

    lines = ["📋 Семейные платежи:"]
    for bid, title, amount, day, person, paid in rows:
        status = "✅ Оплачено" if paid == month_key() else "⏳ Не оплачено"
        lines.append(
            f"№{bid} — {title}: {amount:.2f} ₽, до {day}-го числа\n"
            f"Ответственный: {person} · {status}"
        )
    await message.answer("\n\n".join(lines))


@dp.message(Command("paid"))
async def paid_bill(message: Message):
    try:
        bill_id = int(message.text.split()[1])
        with sqlite3.connect(DB) as con:
            cur = con.execute(
                "UPDATE bills SET paid_month=? WHERE id=? AND chat_id=?",
                (month_key(), bill_id, message.chat.id)
            )
        if cur.rowcount:
            await message.answer(f"✅ Платёж №{bill_id} отмечен оплаченным!")
        else:
            await message.answer("Не нашёл такой платёж. Проверь номер через /list.")
    except Exception:
        await message.answer("Напиши так: /paid 1")


@dp.message(Command("report"))
async def report(message: Message):
    with sqlite3.connect(DB) as con:
        rows = con.execute(
            "SELECT amount, paid_month FROM bills WHERE chat_id=?",
            (message.chat.id,)
        ).fetchall()

    total = sum(r[0] for r in rows)
    paid = sum(r[0] for r in rows if r[1] == month_key())
    await message.answer(
        f"📊 Отчёт за {month_key()}\n"
        f"Всего платежей: {len(rows)}\n"
        f"Сумма: {total:.2f} ₽\n"
        f"Оплачено: {paid:.2f} ₽\n"
        f"Осталось: {total - paid:.2f} ₽"
    )


async def reminders():
    while True:
        now = datetime.now(TZ)
        if now.hour == 9 and now.minute == 0:
            today = now.date()
            with sqlite3.connect(DB) as con:
                rows = con.execute(
                    "SELECT id, title, amount, day, responsible, chat_id, paid_month "
                    "FROM bills"
                ).fetchall()

                for bid, title, amount, day, person, chat_id, paid in rows:
                    last_day = calendar.monthrange(today.year, today.month)[1]
                    due = date(today.year, today.month, min(day, last_day))
                    if paid == month_key():
                        continue

                    days_left = (due - today).days
                    kind = (
                        "за 3 дня" if days_left == 3 else
                        "сегодня" if days_left == 0 else
                        "просрочен" if days_left < 0 else None
                    )
                    if not kind:
                        continue

                    try:
                        con.execute(
                            "INSERT INTO notices VALUES (?, ?, ?)",
                            (bid, today.isoformat(), kind)
                        )
                        await bot.send_message(
                            chat_id,
                            f"🔔 Напоминание: платёж «{title}» — "
                            f"{amount:.2f} ₽. Ответственный: {person}. "
                            f"Срок: {due.strftime('%d.%m.%Y')} — {kind}."
                        )
                    except sqlite3.IntegrityError:
                        pass
                    except Exception:
                        pass
                con.commit()
        await asyncio.sleep(60)


async def main():
    init_db()
    asyncio.create_task(reminders())
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
