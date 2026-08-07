/**
 * Servidor do Bot de WhatsApp com IA Groq (Llama 3.3 70B) - Pizzaria DellOS
 * 100% Gratuito, Ultra-Rápido (sub-segundo) e Sem limites de cota zerada!
 */

require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const GROQ_KEY = process.env.GROQ_API_KEY;

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
  res.send('🍕 DellOS Pizza WhatsApp IA Server - Status: ONLINE (Groq Llama 3.3 Engine)');
});

app.post('/webhook/whatsapp', async (req, res) => {
  try {
    const rawKey = process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY;
    
    if (!rawKey) {
      console.error('[Erro] GROQ_API_KEY vazia no Environment do Render.');
      return res.status(500).json({ error: 'GROQ_API_KEY_MISSING' });
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

    // Trava de segurança contra loops de mensagens próprias da IA
    if (messageText.includes('Confirmação de Lançamento') || 
        messageText.includes('Venda Registrada') ||
        messageText.startsWith('📝') || 
        messageText.startsWith('🍕') || 
        messageText.startsWith('✅')) {
      return res.status(200).send({ status: 'ignored_bot_own_response' });
    }

    console.log(`[WhatsApp Processing Groq] De ${userPhone}: "${messageText}"`);

    // Chamada à API Ultra-Rápida do Groq (Llama 3.3 70B Versatile)
    const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
    
    const requestBody = {
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: messageText }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1
    };

    const groqResponse = await axios.post(groqUrl, requestBody, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    const responseContent = groqResponse.data.choices[0].message.content;
    const parsedJSON = JSON.parse(responseContent);
    console.log('[Groq IA Success Response]:', parsedJSON);

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
    console.error('[Erro Webhook Groq Details]:', JSON.stringify(errorDetails));
    return res.status(500).json({ status: 'error', error: errorDetails });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor Bot WhatsApp IA (Groq) rodando na porta ${PORT}`));
