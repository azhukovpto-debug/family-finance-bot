const HELP = `🏠 СЕМЕЙНЫЙ БЮДЖЕТ

/income 85000 зарплата — добавить доход
/expense 1200 продукты — добавить расход
/addpayment Кредит | 18000 | 2026-11-15 — добавить платёж
/payments — список платежей
/paid 1 — отметить платёж оплаченным
/report — отчёт за месяц
/history — история операций
/help — помощь

Все суммы в рублях.`;

async function send(env, chatId, text) {
  const r = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text })
    }
  );
  const result = await r.json();
  console.log("Telegram:", JSON.stringify(result));
  if (!result.ok) throw new Error(JSON.stringify(result));
}

const money = n =>
  new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2
  }).format(Number(n || 0)) + " ₽";

const today = () => new Date().toISOString().slice(0, 10);

function nextMonth(date) {
  const [y, m, d] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + 1, Math.min(d, last)))
    .toISOString().slice(0, 10);
}

function parseAmount(value) {
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function handle(message, env) {
  if (!message?.text) return;

  const chat = message.chat.id;
  const text = message.text.trim();
  const command = text.split(/\s+/)[0].split("@")[0].toLowerCase();
  const args = text.slice(text.split(/\s+/)[0].length).trim();

  if (!env.DB) {
    await send(env, chat, "Не подключена база данных D1. Нужно настроить DB в Cloudflare.");
    return;
  }

  if (command === "/start" || command === "/help") {
    await send(env, chat, HELP);
    return;
  }

  if (command === "/income" || command === "/expense") {
    const match = args.match(/^([0-9]+(?:[.,][0-9]{1,2})?)(?:\s+(.+))?$/);
    if (!match) {
      await send(env, chat,
        command === "/income"
          ? "Напиши: /income 85000 зарплата"
          : "Напиши: /expense 1200 продукты"
      );
      return;
    }

    const sum = parseAmount(match[1]);
    if (!sum) {
      await send(env, chat, "Укажи корректную сумму больше нуля.");
      return;
    }

    const note = (match[2] || (command === "/income" ? "Доход" : "Расход")).slice(0, 200);
    const table = command === "/income" ? "incomes" : "expenses";

    await env.DB.prepare(
      `INSERT INTO ${table} (chat_id, amount, note, entry_date) VALUES (?, ?, ?, ?)`
    ).bind(String(chat), sum, note, today()).run();

    await send(env, chat, `✅ Записано: ${money(sum)}\n${note}`);
    return;
  }

  if (command === "/addpayment") {
    const p = args.split("|").map(x => x.trim());

    if (
      p.length !== 3 ||
      !p[0] ||
      !parseAmount(p[1]) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(p[2])
    ) {
      await send(env, chat,
        "Формат:\n/addpayment Кредит | 18000 | 2026-11-15\nДата — ГГГГ-ММ-ДД."
      );
      return;
    }

    await env.DB.prepare(
      "INSERT INTO payments (chat_id,title,amount,next_due_date,active) VALUES (?,?,?,?,1)"
    ).bind(String(chat), p[0], parseAmount(p[1]), p[2]).run();

    await send(env, chat,
      `✅ Платёж добавлен\n${p[0]}\n${money(p[1])}\nДата: ${p[2]}\nПовторяется ежемесячно.`
    );
    return;
  }

  if (command === "/payments") {
    const { results } = await env.DB.prepare(
      "SELECT id,title,amount,next_due_date FROM payments WHERE chat_id=? AND active=1 ORDER BY next_due_date"
    ).bind(String(chat)).all();

    if (!results.length) {
      await send(env, chat, "Обязательных платежей пока нет.");
      return;
    }

    await send(env, chat,
      "🏦 ОБЯЗАТЕЛЬНЫЕ ПЛАТЕЖИ\n\n" +
      results.map(p =>
        `№${p.id} ${p.title} — ${money(p.amount)} — ${p.next_due_date}`
      ).join("\n") +
      "\n\nЧтобы отметить оплату: /paid НОМЕР"
    );
    return;
  }

  if (command === "/paid") {
    const id = Number(args);
    if (!Number.isInteger(id) || id <= 0) {
      await send(env, chat, "Напиши, например: /paid 1");
      return;
    }

    const p = await env.DB.prepare(
      "SELECT * FROM payments WHERE id=? AND chat_id=? AND active=1"
    ).bind(id, String(chat)).first();

    if (!p) {
      await send(env, chat, "Платёж не найден. Проверь /payments.");
      return;
    }

    await env.DB.prepare(
      "INSERT INTO expenses (chat_id,amount,note,entry_date) VALUES (?,?,?,?)"
    ).bind(String(chat), p.amount, "Оплата: " + p.title, today()).run();

    await env.DB.prepare(
      "UPDATE payments SET next_due_date=? WHERE id=? AND chat_id=?"
    ).bind(nextMonth(p.next_due_date), id, String(chat)).run();

    await send(env, chat,
      `✅ Оплата отмечена: ${p.title}\n${money(p.amount)}\nСледующая дата: ${nextMonth(p.next_due_date)}`
    );
    return;
  }

  if (command === "/report") {
    const month = today().slice(0, 7);

    const income = await env.DB.prepare(
      "SELECT COALESCE(SUM(amount),0) total FROM incomes WHERE chat_id=? AND substr(entry_date,1,7)=?"
    ).bind(String(chat), month).first();

    const expense = await env.DB.prepare(
      "SELECT COALESCE(SUM(amount),0) total FROM expenses WHERE chat_id=? AND substr(entry_date,1,7)=?"
    ).bind(String(chat), month).first();

    const balance = income.total - expense.total;

    await send(env, chat,
      `📊 ОТЧЁТ ЗА ${month}\n\n` +
      `💰 Доходы: ${money(income.total)}\n` +
      `🛒 Расходы: ${money(expense.total)}\n` +
      `💵 Остаток: ${money(balance)}`
    );
    return;
  }

  if (command === "/history") {
    const { results } = await env.DB.prepare(`
      SELECT entry_date,amount,note,'Доход' kind
      FROM incomes WHERE chat_id=?
      UNION ALL
      SELECT entry_date,amount,note,'Расход' kind
      FROM expenses WHERE chat_id=?
      ORDER BY entry_date DESC LIMIT 20
    `).bind(String(chat), String(chat)).all();

    if (!results.length) {
      await send(env, chat, "Операций пока нет.");
      return;
    }

    await send(env, chat,
      "📚 ПОСЛЕДНИЕ ОПЕРАЦИИ\n\n" +
      results.map(x =>
        `${x.entry_date} · ${x.kind}: ${money(x.amount)} · ${x.note}`
      ).join("\n")
    );
    return;
  }

  await send(env, chat, "Неизвестная команда. Напиши /help.");
}

async function reminders(env) {
  const { results } = await env.DB.prepare(`
    SELECT id,chat_id,title,amount,next_due_date,
    CAST(julianday(next_due_date)-julianday(date('now')) AS INTEGER) days_left
    FROM payments
    WHERE active=1
    AND next_due_date IN (date('now'),date('now','+3 days'))
  `).all();

  for (const p of results) {
    const exists = await env.DB.prepare(
      "SELECT id FROM reminders_sent WHERE payment_id=? AND due_date=? AND days_left=?"
    ).bind(p.id, p.next_due_date, p.days_left).first();

    if (exists) continue;

    const when = p.days_left === 0 ? "сегодня" : "через 3 дня";

    try {
      await send(env, p.chat_id,
        `🔔 НАПОМИНАНИЕ\n${p.title}\n${money(p.amount)}\nОплатить ${when}!`
      );

      await env.DB.prepare(
        "INSERT INTO reminders_sent (payment_id,due_date,days_left) VALUES (?,?,?)"
      ).bind(p.id, p.next_due_date, p.days_left).run();
    } catch (e) {
      console.log("Reminder error:", e.message);
    }
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "GET") {
      return new Response("Family Finance Bot работает!");
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const update = await request.json();
      if (update.message) await handle(update.message, env);
      return new Response("OK");
    } catch (e) {
      console.log("Worker error:", e.stack || e.message);
      return new Response("OK");
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(reminders(env));
  }
};
