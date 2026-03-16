const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ZAPI_INSTANCE = process.env.ZAPI_INSTANCE;
const ZAPI_TOKEN = process.env.ZAPI_TOKEN;
const ZAPI_CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN;
const PORT = process.env.PORT || 8080;

const SYSTEM_PROMPT = `Você é um vendedor especialista da Royal Celulares. Atenda com excelência, seja natural e amigável como WhatsApp. Respostas curtas, máximo 3-4 linhas, sem asteriscos. Venda iPhones novos/seminovos, Xiaomi e acessórios. Faça uma pergunta de cada vez para entender o cliente.`;

const conversations = new Map();

app.get('/', (req, res) => {
  res.send('Royal Celulares Bot rodando!');
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (body.fromMe) return;
    if (body.type !== 'ReceivedCallback') return;
    if (!body.text || !body.text.message) return;

    const phone = body.phone;
    const message = body.text.message;

    if (!conversations.has(phone)) conversations.set(phone, []);
    const history = conversations.get(phone);
    history.push({ role: 'user', content: message });
    if (history.length > 20) history.splice(0, history.length - 20);

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: history
      },
      {
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      }
    );

    const reply = response.data.content[0].text;
    history.push({ role: 'assistant', content: reply });

    await axios.post(
      `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`,
      { phone, message: reply },
      { headers: { 'Client-Token': ZAPI_CLIENT_TOKEN } }
    );

  } catch (err) {
    console.error('Erro:', err.response?.data || err.message);
  }
});

app.listen(PORT, () => {
  console.log('Bot rodando na porta ' + PORT);
});
