/**
 * Servidor do Bot de WhatsApp com IA Gemini - Pizzaria DellOS
 * Compatível 100% com as novas chaves `AQ.` do Google AI Studio 2026.
 */

require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const GEMINI_KEY = process.env.GEMINI_API_KEY;

const SYSTEM_PROMPT = `
Você é o Assessor Financeiro DellOS, um agente especialista em gestão financeira e DRE de pizzarias delivery.

SEU OBJETIVO:
Interpretar dados de despesas, compras de insumos, contas ou vendas informados pelo gestor (em texto ou áudio) e convertê-los em um registro JSON perfeitamente estruturado.

REGRAS DE CLASSIFICAÇÃO DRE:
1. RECEITA_VENDAS: Vendas diárias de delivery/balcão.
2. CMV_INSUMOS: Queijo mussarela, catupiry, presunto, calabresa, farinha, fermento, molhos, bordas, refrigerantes e caixas de pizza.
3. MAO_DE_OBRA: Salários de pizzaiolos, forneiros, atendentes, diárias e pró-labore.
4. TAXAS_E_VARIAVEIS: Comissões iFood/Aiqfome, taxa de cartão, impostos Simples e motoboys.
5. CUSTOS_FIXOS: Aluguel, energia elétrica, gás, água, marketing e internet.

Sua resposta DEVE ser um objeto JSON válido no seguinte formato:
{
  "mensagem_whatsapp": "Texto formatado com emojis em negrito confirmando os dados lidos para o gestor",
  "transacao": {
    "tipo": "despesa",
    "categoria_dre": "CMV_INSUMOS",
    "subcategoria": "Laticínios",
    "fornecedor_canal": "Nome do fornecedor ou canal",
    "valor": 100.00,
    "forma_pagamento": "PIX",
    "requer_confirmacao": true
  }
}
`;

app.get('/', (req, res) => {
  res.send('🍕 DellOS Pizza WhatsApp IA Server - Status: ONLINE (Chaves AQ. Válidas)');
});

app.post('/webhook/whatsapp', async (req, res) => {
  try {
    if (!GEMINI_KEY) {
      console.error('[Erro] GEMINI_API_KEY não configurada nas variáveis de ambiente.');
      return res.status(500).json({ error: 'GEMINI_API_KEY_MISSING' });
    }

    const payload = req.body;
    console.log('[Webhook Received]:', JSON.stringify(payload));

    const messageData = payload.data || payload;
    const userPhone = messageData.key?.remoteJid;

    if (!userPhone) return res.status(200).send({ status: 'no_user_phone' });

    const messageText = messageData.message?.conversation || 
                        messageData.message?.extendedTextMessage?.text ||
                        messageData.body;

    if (!messageText) return res.status(200).send({ status: 'no_text_message' });

    // Trava de segurança para não dar loop infinito nas respostas da IA
    if (messageText.includes('Confirmação de Lançamento') || 
        messageText.includes('Venda Registrada') ||
        messageText.startsWith('📝') || 
        messageText.startsWith('🍕') || 
        messageText.startsWith('✅')) {
      return res.status(200).send({ status: 'ignored_bot_own_response' });
    }

    console.log(`[WhatsApp Processing] De ${userPhone}: "${messageText}"`);

    // Chamada HTTP Direta à API do Gemini suportando o novo formato `AQ.` da Google
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`;
    
    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [{ text: `${SYSTEM_PROMPT}\n\nMensagem do Gestor: "${messageText}"` }]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json"
      }
    };

    const geminiResponse = await axios.post(geminiUrl, requestBody, {
      headers: {
        'x-goog-api-key': GEMINI_KEY.trim(),
        'Content-Type': 'application/json'
      }
    });

    const responseText = geminiResponse.data.candidates[0].content.parts[0].text;
    const parsedJSON = JSON.parse(responseText);
    console.log('[Gemini IA Response]:', parsedJSON);

    // Dispara mensagem de volta via Evolution API se a URL estiver configurada
    const evoUrl = process.env.EVOLUTION_API_URL || 'https://evolution-api-production-16bcd.up.railway.app';
    const evoKey = process.env.EVOLUTION_API_KEY || 'dellos_pizza_2026';
    const instanceName = process.env.EVOLUTION_INSTANCE || 'PizzariaFinanceiro';

    if (evoUrl) {
      const cleanPhone = userPhone.replace('@s.whatsapp.net', '');
      await axios.post(`${evoUrl}/message/sendText/${instanceName}`, {
        number: cleanPhone,
        text: parsedJSON.mensagem_whatsapp
      }, {
        headers: { 'apikey': evoKey }
      });
      console.log(`[Evolution Send Success] Resposta enviada para ${cleanPhone}`);
    }

    return res.status(200).json({ status: 'success', parsed: parsedJSON });

  } catch (error) {
    console.error('[Erro Webhook]:', error.response?.data || error.message);
    return res.status(500).json({ status: 'error', error: error.response?.data || error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor Bot WhatsApp IA rodando na porta ${PORT}`));
