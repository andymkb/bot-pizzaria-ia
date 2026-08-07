/**
 * Servidor do Bot de WhatsApp com IA Gemini - Pizzaria DellOS
 * Com retry automático de 3 segundos contra o limite de requisições por minuto (Rate Limit 429).
 */

require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

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

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

app.get('/', (req, res) => {
  res.send('🍕 DellOS Pizza WhatsApp IA Server - Status: ONLINE (With Auto-Retry)');
});

app.post('/webhook/whatsapp', async (req, res) => {
  try {
    const rawKey = process.env.GEMINI_API_KEY;
    
    if (!rawKey) {
      console.error('[Erro] GEMINI_API_KEY vazia no Environment do Render.');
      return res.status(500).json({ error: 'GEMINI_API_KEY_MISSING' });
    }

    const apiKey = rawKey.trim();
    const payload = req.body;
    const messageData = payload.data || payload;
    const userPhone = messageData.key?.remoteJid;

    if (!userPhone) return res.status(200).send({ status: 'no_user_phone' });

    const messageText = messageData.message?.conversation || 
                        messageData.message?.extendedTextMessage?.text ||
                        messageData.body;

    if (!messageText) return res.status(200).send({ status: 'no_text_message' });

    // Trava de segurança para não dar loop nas respostas do próprio bot
    if (messageText.includes('Confirmação de Lançamento') || 
        messageText.includes('Venda Registrada') ||
        messageText.startsWith('📝') || 
        messageText.startsWith('🍕') || 
        messageText.startsWith('✅')) {
      return res.status(200).send({ status: 'ignored_bot_own_response' });
    }

    console.log(`[WhatsApp Processing] De ${userPhone}: "${messageText}"`);

    const candidateModels = [
      'gemini-1.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-pro'
    ];

    let geminiResponse = null;
    let lastErr = null;

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

    // Tenta cada modelo com até 2 retentativas de 3 segundos se der erro 429
    for (const modelName of candidateModels) {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          console.log(`[Gemini Request] Modelo ${modelName} (Tentativa ${attempt})...`);
          
          geminiResponse = await axios.post(geminiUrl, requestBody, {
            headers: { 'Content-Type': 'application/json' }
          });
          
          if (geminiResponse.data && geminiResponse.data.candidates) {
            console.log(`[Gemini Success] Respondido com SUCESSO pelo modelo ${modelName}!`);
            break;
          }
        } catch (err) {
          lastErr = err.response?.data || err.message;
          const status = err.response?.status;
          
          if (status === 429 && attempt < 2) {
            console.warn(`[Gemini Rate Limit 429] Limite temporário atingido. Aguardando 3s para tentar novamente...`);
            await delay(3000);
          } else {
            console.warn(`[Gemini Warning] Modelo ${modelName} recusado:`, err.response?.data?.error?.message || err.message);
            break;
          }
        }
      }

      if (geminiResponse && geminiResponse.data && geminiResponse.data.candidates) {
        break;
      }
    }

    if (!geminiResponse || !geminiResponse.data) {
      console.error('[Gemini All Models Failed]:', JSON.stringify(lastErr));
      return res.status(500).json({ error: 'ALL_GEMINI_MODELS_FAILED', details: lastErr });
    }

    const responseText = geminiResponse.data.candidates[0].content.parts[0].text;
    const parsedJSON = JSON.parse(responseText);
    console.log('[Gemini IA Success Response]:', parsedJSON);

    // Dispara resposta para a Evolution API no Railway
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
    const errorDetails = error.response?.data || error.message;
    console.error('[Erro Webhook Details]:', JSON.stringify(errorDetails));
    return res.status(500).json({ status: 'error', error: errorDetails });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor Bot WhatsApp IA rodando na porta ${PORT}`));
