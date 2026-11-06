export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Family Finance Bot работает!");
    }

    const update = await request.json();
    const message = update.message;

    if (!message || !message.text) {
      return new Response("OK");
    }

    const chatId = message.chat.id;
    const text = message.text.trim();

    let reply;

    if (text === "/start") {
      reply = "Привет! 👋 Семейный финансовый бот готов!\n\n/add — добавить платёж\n/list — список платежей\n/report — отчёт";
    } else if (text === "/help") {
      reply = "Команды: /add, /list, /report";
    } else if (text === "/list") {
      reply = "Список платежей пока пуст.";
    } else if (text === "/report") {
      reply = "Отчёт пока пуст.";
    } else {
      reply = "Пока не знаю такую команду. Напиши /help";
    }

    await fetch(
      `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: reply
        })
      }
    );

    return new Response("OK");
  }
};
