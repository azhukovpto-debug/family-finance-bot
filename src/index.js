
export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Family Finance Bot работает!");
    }

    try {
      const update = await request.json();
      const message = update.message;

      if (!message?.text) {
        return new Response("OK");
      }

      if (!env.BOT_TOKEN) {
        console.log("ОШИБКА: BOT_TOKEN отсутствует");
        return new Response("OK");
      }

      const chatId = message.chat.id;
      const text = message.text.trim();

      let reply;

      if (text === "/start") {
        reply = "Привет! 👋 Семейный финансовый бот работает!\n\nКоманды:\n/add — добавить платёж\n/list — список платежей\n/report — отчёт";
      } else if (text === "/help") {
        reply = "Команды: /add, /list, /report";
      } else if (text === "/list") {
        reply = "Пока платежей нет.";
      } else if (text === "/report") {
        reply = "Пока отчётов нет.";
      } else {
        reply = "Неизвестная команда. Напиши /help";
      }

      const response = await fetch(
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

      const result = await response.text();

      console.log("Telegram status:", response.status);
      console.log("Telegram response:", result);

      return new Response("OK");

    } catch (error) {
      console.log("Worker error:", error.message);
      return new Response("OK");
    }
  }
};
