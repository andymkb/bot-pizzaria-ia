/**
 * Servidor do Bot de WhatsApp com IA Gemini - Pizzaria DellOS
 * Auto-descoberta de modelos disponíveis na chave via ListModels.
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

app.get('/', (req, res) => {
  res.send('🍕 DellOS Pizza WhatsApp IA Server - Status: ONLINE (Auto-Discover)');
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

    // 1. Auto-descobre quais modelos a chave suporta chamando ListModels
    let availableModelNames = [];
    try {
      const listResp = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      if (listResp.data && listResp.data.models) {
        availableModelNames = listResp.data.models
          .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
          .map(m => m.name.replace('models/', ''));
        console.log('[Gemini Auto-Discovery] Modelos com generateContent disponíveis nesta chave:', availableModelNames);
      }
    } catch (listErr) {
      console.warn('[Gemini Auto-Discovery Warning] Não foi possível listar os modelos:', listErr.message);
    }

    // Se a auto-descoberta não retornou nada, usa lista padrão como fallback
    if (availableModelNames.length === 0) {
      availableModelNames = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-1.0-pro'];
    }

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

    // Tenta cada modelo descoberto
    for (const modelName of availableModelNames) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        console.log(`[Gemini Request] Tentando modelo descoberto: ${modelName}...`);
        
        geminiResponse = await axios.post(geminiUrl, requestBody, {
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        if (geminiResponse.data && geminiResponse.data.candidates) {
          console.log(`[Gemini Success] Respondido com sucesso pelo modelo ${modelName}!`);
          break;
        }
      } catch (err) {
        lastErr = err.response?.data || err.message;
        console.warn(`[Gemini Warning] Modelo ${modelName} erro:`, JSON.stringify(lastErr));
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
