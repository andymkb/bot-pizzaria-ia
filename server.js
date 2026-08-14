/**
 * Servidor do Bot de WhatsApp com IA Groq (Llama 3.3 70B) + Conexão Supabase
 * TRAVA MATEMÁTICA DE GRUPO ÚNICO (ALLOWED_GROUP_ID):
 * Responde EXCLUSIVAMENTE ao ID do Grupo de Lançamentos da Pizzaria.
 * Ignora 100% de outros grupos, conversas privadas e contatos pessoais.
 */

require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xahnpppotcieqdqspvmy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_sw3WY4mg1fX0bNJT6bSDjA_gzBczyB-';

const ALLOWED_GROUP_ID = process.env.ALLOWED_GROUP_ID;

const SYSTEM_PROMPT = `
Você é o Assessor Financeiro DellOS, um agente especialista em gestão financeira e DRE de pizzarias delivery.

SEU OBJETIVO:
Interpretar dados de despesas, compras de insumos, contas ou vendas informados pelo gestor ou sua sócia (em texto ou áudio) e convertê-los em um registro JSON perfeitamente estruturado.

REGRAS DE CLASSIFICAÇÃO DRE:
1. RECEITA_VENDAS: Vendas diárias de delivery/balcão.
2. CMV_INSUMOS: Queijo mussarela, catupiry, presunto, calabresa, farinha, fermento, molhos, bordas, refrigerantes e caixas de pizza.
3. MAO_DE_OBRA: Salários de pizzaiolos, forneiros, atendentes, diárias e pró-labore.
4. TAXAS_E_VARIAVEIS: Comissões iFood/Aiqfome, taxa de cartão, impostos Simples e motoboys.
5. CUSTOS_FIXOS: Aluguel, energia elétrica, gás, água, marketing e internet.

Sua resposta DEVE ser um objeto JSON válido no seguinte formato:
{
  "mensagem_whatsapp": "Texto formatado com emojis em negrito confirmando os dados lidos para os sócios",
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
  res.send('🍕 DellOS Pizza WhatsApp IA Server - Status: ONLINE (Single Group Lock Mode)');
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
    const userPhone = messageData.key?.remoteJid || messageData.remoteJid;

    if (!userPhone) return res.status(200).send({ status: 'no_user_phone' });

    // 🛑 BLOQUEIO 1: Ignora conversas privadas individuais (só aceita grupos @g.us)
    const isGroup = userPhone.endsWith('@g.us') || !!messageData.key?.participant;
    if (!isGroup) {
      console.log(`[WhatsApp Ignored Private Chat] Conversa privada ignorada (${userPhone})`);
      return res.status(200).send({ status: 'ignored_private_chat' });
    }

    // 🛑 BLOQUEIO 2: Se o ALLOWED_GROUP_ID estiver configurado, aceita APENAS a mensagem desse grupo exato!
    if (ALLOWED_GROUP_ID && ALLOWED_GROUP_ID.trim() !== '' && userPhone !== ALLOWED_GROUP_ID.trim()) {
      console.log(`[WhatsApp Ignored Unallowed Group] Grupo ${userPhone} não é o autorizado (${ALLOWED_GROUP_ID})`);
      return res.status(200).send({ status: 'ignored_unallowed_group' });
    }

    const messageText = messageData.message?.conversation || 
                        messageData.message?.extendedTextMessage?.text ||
                        messageData.body || '';

    if (!messageText) return res.status(200).send({ status: 'no_text_message' });

    // Trava de segurança contra loops de mensagens enviadas pela própria IA
    if (messageText.includes('Confirmação de Lançamento') || 
        messageText.includes('Venda Registrada') ||
        messageText.includes('Confirmação de compra') ||
        messageText.startsWith('📝') || 
        messageText.startsWith('🍕') || 
        messageText.startsWith('✅')) {
      return res.status(200).send({ status: 'ignored_bot_own_response' });
    }

    console.log(`[WhatsApp Target Group Match!] Grupo ID: "${userPhone}" | Mensagem: "${messageText}"`);

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

    // Grava transação diretamente no Banco de Dados Supabase em Nuvem
    try {
      const t = parsedJSON.transacao;
      await axios.post(`${SUPABASE_URL}/rest/v1/transacoes`, {
        tipo: t.tipo || 'despesa',
        categoria_dre: t.categoria_dre || 'CMV_INSUMOS',
        subcategoria: t.subcategoria || 'Outros',
        fornecedor_canal: t.fornecedor_canal || 'Não informado',
        valor: parseFloat(t.valor) || 0,
        forma_pagamento: t.forma_pagamento || 'Outros',
        mensagem_original: messageText,
        confirmado: true
      }, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        }
      });
      console.log('[Supabase Success] Transação gravada com SUCESSO no banco SQL!');
    } catch (dbErr) {
      console.error('[Supabase Warning] Erro ao gravar transação no banco:', dbErr.response?.data || dbErr.message);
    }

    // Dispara resposta DE VOLTA NO MESMO GRUPO via Evolution API
    const evoUrl = process.env.EVOLUTION_API_URL || 'https://evolution-api-production-16bcd.up.railway.app';
    const evoKey = process.env.EVOLUTION_API_KEY || 'dellos_pizza_2026';
    const instanceName = process.env.EVOLUTION_INSTANCE || 'PizzariaFinanceiro';

    if (evoUrl) {
      await axios.post(`${evoUrl}/message/sendText/${instanceName}`, {
        number: userPhone,
        text: parsedJSON.mensagem_whatsapp
      }, {
        headers: { 'apikey': evoKey }
      });
      console.log(`[Evolution Send Success] Resposta enviada no Grupo ${userPhone}`);
    }

    return res.status(200).json({ status: 'success', parsed: parsedJSON });

  } catch (error) {
    const errorDetails = error.response?.data || error.message;
    console.error('[Erro Webhook Groq Details]:', JSON.stringify(errorDetails));
    return res.status(500).json({ status: 'error', error: errorDetails });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor Bot WhatsApp IA (Single Group Lock Mode) rodando na porta ${PORT}`));
