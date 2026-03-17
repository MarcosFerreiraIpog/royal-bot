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
  const extension = mimeType.includes('
