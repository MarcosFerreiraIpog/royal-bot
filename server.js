const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const app = express();
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ZAPI_INSTANCE = process.env.ZAPI_INSTANCE;
const ZAPI_TOKEN = process.env.ZAPI_TOKEN;
const ZAPI_CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN;
const ADMIN_PHONE = '5562991519400';
const SHEETS_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRtBIxdbccBXi-tPFQGQ7kjOkp09kGfDB2UDCObgXqMmAAjZsmFkg6CJIVZmHYhKpNWyhRjCJOy3iw5/pub?output=csv';
const PORT = process.env.PORT || 8080;

const SYSTEM_PROMPT_BASE = `Você é um atendente virtual especializado em vendas e atendimento via WhatsApp de uma loja de eletrônicos e assistência técnica.

Seu objetivo é atender clientes de forma humanizada, entender a necessidade, recomendar produtos ideais e conduzir a conversa até o fechamento da venda.

COMPORTAMENTO
- Fale como um humano, nunca como robô
- Linguagem simples, amigável e natural (estilo WhatsApp)
- Seja consultivo: ajude o cliente a decidir
- Sempre faça perguntas antes de vender
- Nunca responda seco ou curto demais
- Nunca diga que é uma IA
- Sempre conduza a conversa

SOBRE A EMPRESA
A loja vende:
- iPhones (novos e seminovos)
- Produtos JBL
- Smartphones Xiaomi
- Acessórios eletrônicos
- Assistência técnica especializada

Diferenciais:
- Aparelhos revisados e de qualidade
- Garantia de 6 meses em seminovos
- Assistência com garantia de 3 meses até 1 ano

INÍCIO DO ATENDIMENTO
Sempre comece assim:
"Olá! 😊 Seja bem-vindo(a)

Me conta rapidinho, como posso te ajudar hoje?

1️⃣ Comprar celular
2️⃣ Acessórios (JBL, etc.)
3️⃣ Assistência técnica"

PREÇO E DISPONIBILIDADE
NUNCA invente preços. Quando cliente perguntar preço responda EXATAMENTE:
"Deixa eu confirmar o valor atualizado pra você rapidinho 👌
Já te retorno em instantes 😊"
E inclua no final da sua resposta a tag: [CONSULTAR_PRECO: produto que o cliente quer]

TÉCNICAS DE VENDAS
- Confiança: "Todos nossos aparelhos são revisados"
- Escassez: "Está saindo bastante" / "Últimas unidades"
- Fechamento: "Posso separar um pra você?" / "Quer que eu reserve?"

REGRAS
- Nunca inventar preço
- Nunca ser robótico
- Sempre tentar vender
- Sempre entender o cliente antes`;

const conversations = new Map();
const pendingPrices = new Map();
let cachedInstructions = '';
let lastFetch = 0;

async function fetchInstructions() {
  try {
    const now = Date.now();
    if (now - lastFetch < 60000 && cachedInstructions) return cachedInstructions;

    const response = await axios.get(SHEETS_URL);
    const lines = response.data.split('\n').filter(l => l.trim());
    // Pula o cabeçalho e junta todas as instruções
    const instructions = lines.slice(1).join('\n').trim();
    cachedInstructions = instructions;
    lastFetch = now;
    console.log('📋 Instruções atualizadas da planilha');
    return instructions;
  } catch (err) {
    console.error('Erro ao buscar planilha:', err.message);
    return cachedInstructions || '';
  }
}

async function getSystemPrompt() {
  const instructions = await fetchInstructions();
  if (!instructions) return SYSTEM_PROMPT_BASE;
  return `${SYSTEM_PROMPT_BASE}\n\nINSTRUÇÕES ATUALIZADAS (siga com prioridade):\n${instructions}`;
}

async function transcribeAudio(audioBuffer, mimeType) {
  const formData = new FormData();
  const extension = mimeType.includes('ogg') ? 'ogg' : 'mp3';
  formData.append('file', audioBuffer, { filename: `audio.${extension}`, contentType: mimeType });
  formData.append('model', 'whisper-large-v3');
  formData.append('language', 'pt');

  const response = await axios.post(
    'https://api.groq.com/openai/v1/audio/transcriptions',
    formData,
    {
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        ...formData.getHeaders()
      }
    }
  );
  return response.data.text;
}

async function sendWhatsApp(phone, message) {
  await axios.post(
    `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`,
    { phone, message },
    { headers: { 'Client-Token': ZAPI_CLIENT_TOKEN } }
  );
}

async function processMessage(phone, userContent) {
  if (!conversations.has(phone)) conversations.set(phone, []);
  const history = conversations.get(phone);
  history.push({ role: 'user', content: userContent });
  if (history.length > 20) history.splice(0, history.length - 20);

  const systemPrompt = await getSystemPrompt();

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: systemPrompt,
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

  let reply = response.data.content[0].text;

  const match = reply.match(/\[CONSULTAR_PRECO:\s*(.+?)\]/);
  if (match) {
    const produto = match[1].trim();
    reply = reply.replace(/\[CONSULTAR_PRECO:.*?\]/, '').trim();
    pendingPrices.set(phone, produto);

    await sendWhatsApp(
      ADMIN_PHONE,
      `🔔 *Consulta de preço*\n\n👤 Cliente: ${phone}\n📱 Produto: ${produto}\n\nResponda nesse formato:\nPRECO|${phone}|R$ 0.000`
    );
  }

  history.push({ role: 'assistant', content: reply });
  return reply;
}

app.get('/', (req, res) => {
  res.send('Royal Celulares Bot rodando!');
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (body.fromMe) return;
    if (body.type !== 'ReceivedCallback') return;

    const phone = body.phone;

    // RESPOSTA DO ADMIN COM PREÇO
    if (phone === ADMIN_PHONE && body.text?.message) {
      const msg = body.text.message.trim();
      if (msg.startsWith('PRECO|')) {
        const parts = msg.split('|');
        if (parts.length >= 3) {
          const clientPhone = parts[1].trim();
          const valor = parts.slice(2).join('|').trim();
          const produto = pendingPrices.get(clientPhone) || 'produto';

          const priceMsg = `Acabei de verificar aqui no sistema 👌\n\n📱 ${produto}\n💰 ${valor}\n🛡️ Garantia inclusa\n\nSe quiser, já posso separar um pra você 😊`;

          if (!conversations.has(clientPhone)) conversations.set(clientPhone, []);
          conversations.get(clientPhone).push({ role: 'assistant', content: priceMsg });

          await sendWhatsApp(clientPhone, priceMsg);
          await sendWhatsApp(ADMIN_PHONE, `✅ Preço enviado para o cliente ${clientPhone}`);
          pendingPrices.delete(clientPhone);
        }
      }
      return;
    }

    // MENSAGEM DE TEXTO
    if (body.text?.message) {
      const message = body.text.message;
      console.log(`📩 [${phone}] ${message}`);
      const reply = await processMessage(phone, message);
      await sendWhatsApp(phone, reply);
      return;
    }

    // MENSAGEM DE ÁUDIO
    if (body.audio?.audioUrl) {
      console.log(`🎤 [${phone}] Áudio recebido`);
      const audioUrl = body.audio.audioUrl;
      const mimeType = body.audio.mimeType || 'audio/ogg';

      const audioResponse = await axios.get(audioUrl, { responseType: 'arraybuffer' });
      const audioBuffer = Buffer.from(audioResponse.data);

      const transcription = await transcribeAudio(audioBuffer, mimeType);
      console.log(`📝 Transcrição: ${transcription}`);

      const reply = await processMessage(phone, `[Áudio]: ${transcription}`);
      await sendWhatsApp(phone, reply);
      return;
    }

  } catch (err) {
    console.error('Erro:', err.response?.data || err.message);
  }
});

app.listen(PORT, () => {
  console.log('Bot rodando na porta ' + PORT);
});
